/**
 * ============================================================================
 *  connection.js — Bağlantı Yöneticisi (transport soyutlaması)
 *  ----------------------------------------------------------------------------
 *  Tek bir arayüz altında dört kaynağı yönetir:
 *     MOCK      -> CONFIG.mockMode === true iken sahte veri
 *     WS        -> WebSocket (birincil)
 *     MQTT      -> MQTT over WebSocket (mqtt.js gerekir)
 *     HTTP      -> REST polling (WebSocket başarısız olursa fallback)
 *
 *  Olaylar (manager.on('<olay>', cb)):
 *     'status'    -> (statusObj)   şemaya uygun anlık durum geldiğinde
 *     'transport' -> ('WS'|'MQTT'|'HTTP'|'MOCK')  aktif kaynak değiştiğinde
 *     'error'     -> (Error|string)
 *
 *  Cihaz tarafı için beklenen sözleşme:
 *     - WS/MQTT mesaj gövdesi = durum JSON'u (CONFIG yorumundaki şema)
 *     - Komut: WS  -> ws.send(JSON.stringify({type:'command', deviceId, command}))
 *              MQTT-> publish(flare/device/{deviceId}/command, command)
 *              HTTP-> POST {baseUrl}/api/command  {deviceId, command}
 * ============================================================================
 */

class ConnectionManager {
  constructor() {
    this.listeners = { status: [], transport: [], error: [] };
    this.activeTransport = null;

    // Transport durum nesneleri
    this.ws = null;
    this.wsReconnectTimer = null;
    this.mqttClient = null;
    this.httpTimer = null;
    this.mockSources = {};   // { deviceId: MockSource }
    this._stopped = true;
  }

  /* ----------------------------- Olay sistemi ---------------------------- */
  on(event, cb) {
    if (this.listeners[event]) this.listeners[event].push(cb);
    return this;
  }
  _emit(event, payload) {
    (this.listeners[event] || []).forEach((cb) => {
      try { cb(payload); } catch (e) { console.error(e); }
    });
  }
  _setTransport(name) {
    if (this.activeTransport !== name) {
      this.activeTransport = name;
      this._emit('transport', name);
    }
  }

  /* ------------------------------- Başlat -------------------------------- */
  connect() {
    this._stopped = false;
    if (window.CONFIG.mockMode) return this._startMock();

    switch (window.CONFIG.primaryTransport) {
      case 'mqtt': return this._startMqtt();
      case 'http': return this._startHttp();
      case 'websocket':
      default:     return this._startWebSocket();
    }
  }

  disconnect() {
    this._stopped = true;
    clearTimeout(this.wsReconnectTimer);
    clearInterval(this.httpTimer);
    Object.values(this.mockSources).forEach((m) => m.stop());
    this.mockSources = {};
    if (this.ws) { try { this.ws.close(); } catch (_) {} this.ws = null; }
    if (this.mqttClient) { try { this.mqttClient.end(true); } catch (_) {} this.mqttClient = null; }
  }

  /* -------------------------------- MOCK --------------------------------- */
  _startMock() {
    this._setTransport('MOCK');
    // Her cihaz için ayrı bir sahte kaynak çalıştır (çoklu cihaz testi)
    window.CONFIG.devices.forEach((dev) => {
      const src = new MockSource(dev);
      this.mockSources[dev.id] = src;
      src.start((status) => this._emit('status', status));
    });
  }

  /* ------------------------------ WEBSOCKET ------------------------------ */
  _startWebSocket() {
    const url = window.CONFIG.websocket.url;
    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      this._emit('error', e);
      return this._fallbackToHttp();
    }

    this.ws.onopen = () => this._setTransport('WS');

    this.ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        // Cihaz tek bir durum ya da {type:'status', data:{...}} gönderebilir
        const status = data.type === 'status' && data.data ? data.data : data;
        if (status && status.deviceId) this._emit('status', status);
      } catch (e) {
        this._emit('error', 'WS JSON çözümlenemedi: ' + e.message);
      }
    };

    this.ws.onerror = () => this._emit('error', 'WebSocket hatası');

    this.ws.onclose = () => {
      if (this._stopped) return;
      // Birincil WS koptu: önce HTTP'ye düş, sonra arada bir WS'i tekrar dene
      this._fallbackToHttp();
      this.wsReconnectTimer = setTimeout(
        () => { if (!this._stopped) this._startWebSocket(); },
        window.CONFIG.websocket.reconnectDelayMs
      );
    };
  }

  _fallbackToHttp() {
    if (this._stopped || this.httpTimer) return;
    this._startHttp();
  }

  /* -------------------------------- HTTP --------------------------------- */
  _startHttp() {
    this._setTransport('HTTP');
    const poll = async () => {
      try {
        const res = await fetch(`${window.CONFIG.http.baseUrl}/api/status`, { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const status = await res.json();
        if (status && status.deviceId) this._emit('status', status);
      } catch (e) {
        this._emit('error', 'HTTP polling: ' + e.message);
        // Hata olsa bile polling devam eder; app çevrimdışı durumunu zaten gösterir.
      }
    };
    poll();
    this.httpTimer = setInterval(poll, window.CONFIG.http.pollIntervalMs);
  }

  /* -------------------------------- MQTT --------------------------------- */
  _startMqtt() {
    if (typeof mqtt === 'undefined') {
      this._emit('error', 'mqtt.js yüklü değil — HTTP fallback kullanılıyor');
      return this._startHttp();
    }
    const { brokerUrl, statusTopic, username, password } = window.CONFIG.mqtt;
    this.mqttClient = mqtt.connect(brokerUrl, {
      username: username || undefined,
      password: password || undefined,
      reconnectPeriod: 3000,
    });

    this.mqttClient.on('connect', () => {
      this._setTransport('MQTT');
      this.mqttClient.subscribe(statusTopic);
    });

    this.mqttClient.on('message', (_topic, payload) => {
      try {
        const status = JSON.parse(payload.toString());
        if (status && status.deviceId) this._emit('status', status);
      } catch (e) {
        this._emit('error', 'MQTT JSON çözümlenemedi: ' + e.message);
      }
    });

    this.mqttClient.on('error', (e) => this._emit('error', 'MQTT: ' + e.message));
  }

  /* ----------------------- Geçmiş alarm verisi --------------------------- */
  /**
   * @param {string} deviceId
   * @param {string} range '1h' | '24h' | '7d' | '30d'
   * @returns {Promise<Array>} alarm geçmişi
   */
  async fetchAlarmHistory(deviceId, range) {
    if (window.CONFIG.mockMode) {
      const src = this.mockSources[deviceId] || Object.values(this.mockSources)[0];
      return src ? src.fetchAlarmHistory(range) : [];
    }
    try {
      const url = `${window.CONFIG.http.baseUrl}/api/alarms?range=${encodeURIComponent(range)}&deviceId=${encodeURIComponent(deviceId)}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      this._emit('error', 'Alarm geçmişi alınamadı: ' + e.message);
      return []; // boş durum — arayüz çökmez
    }
  }

  /* --------------------------- Uzaktan komut ----------------------------- */
  /**
   * @param {string} deviceId
   * @param {string} command 'mute' | 'test' | 'restart'
   * @returns {Promise<{ok:boolean, error?:string}>}
   */
  async sendCommand(deviceId, command) {
    // MOCK
    if (window.CONFIG.mockMode) {
      const src = this.mockSources[deviceId] || Object.values(this.mockSources)[0];
      if (src) return src.sendCommand(command);
      return { ok: false, error: 'mock kaynağı yok' };
    }

    // WS
    if (this.activeTransport === 'WS' && this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: 'command', deviceId, command }));
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    }

    // MQTT
    if (this.activeTransport === 'MQTT' && this.mqttClient && this.mqttClient.connected) {
      const topic = window.CONFIG.mqtt.commandTopicTemplate.replace('{deviceId}', deviceId);
      return new Promise((resolve) => {
        this.mqttClient.publish(topic, command, {}, (err) =>
          resolve(err ? { ok: false, error: err.message } : { ok: true })
        );
      });
    }

    // HTTP
    try {
      const res = await fetch(`${window.CONFIG.http.baseUrl}/api/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, command }),
      });
      return res.ok ? { ok: true } : { ok: false, error: 'HTTP ' + res.status };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
}

window.ConnectionManager = ConnectionManager;
