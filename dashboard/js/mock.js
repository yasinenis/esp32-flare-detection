/**
 * ============================================================================
 *  mock.js — Sahte (mock) veri kaynağı
 *  ----------------------------------------------------------------------------
 *  CONFIG.mockMode === true iken devreye girer. Gerçek cihaz olmadan:
 *    - her CONFIG.http.pollIntervalMs ms'de bir şemaya uygun durum üretir,
 *    - rastgele aralıklarla kısa süreli "alev" alarmları tetikler,
 *    - pil/şarj/sinyal/bellek değerlerini gerçekçi şekilde dalgalandırır,
 *    - geçmiş alarm listesi üretir (grafikler ve günlük için).
 *
 *  ÖNEMLİ: Gerçek cihaza geçmek için CONFIG.mockMode = false yapın; bu dosyada
 *  hiçbir değişiklik gerekmez.
 * ============================================================================
 */

class MockSource {
  constructor(device) {
    this.device = device;          // { id, name }
    this.timer = null;
    this.onStatus = null;

    // Dahili, zamanla değişen durum (gerçekçilik için)
    const bootTime = Math.floor(Date.now() / 1000) - 38211; // ~10.6 saat önce açılmış
    this.state = {
      bootTime,
      batteryPercent: 86,
      charging: true,
      usbConnected: true,
      rssi: -58,
      freeHeap: 142000,
      flameUntil: 0,        // bu epoch'a kadar alev "açık" sayılır
      sensorActive: true,
    };

    // Bir sonraki sahte alarmın ne zaman başlayacağı (epoch sn)
    this.nextAlarmAt = this._scheduleNextAlarm();
  }

  /** 40–120 sn sonrasına rastgele yeni alarm zamanı planlar (test için sık). */
  _scheduleNextAlarm() {
    const now = Math.floor(Date.now() / 1000);
    return now + 40 + Math.floor(Math.random() * 80);
  }

  /** Periyodik durum üretimini başlatır. */
  start(onStatus) {
    this.onStatus = onStatus;
    const interval = (window.CONFIG?.http.pollIntervalMs) || 2000;
    // Hemen ilk veriyi gönder, sonra periyodik devam et
    this._tick();
    this.timer = setInterval(() => this._tick(), interval);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Tek bir durum örneği üretir ve callback ile yollar. */
  _tick() {
    const now = Math.floor(Date.now() / 1000);

    // --- Sahte alarm zamanlaması ---
    if (now >= this.nextAlarmAt && now > this.state.flameUntil) {
      // 5–20 sn sürecek bir alarm başlat
      const dur = 5 + Math.floor(Math.random() * 15);
      this.state.flameUntil = now + dur;
      this.nextAlarmAt = this._scheduleNextAlarm();
    }
    const flameDetected = now < this.state.flameUntil;

    // --- Pil / şarj davranışı ---
    if (this.state.usbConnected && this.state.charging) {
      this.state.batteryPercent = Math.min(100, this.state.batteryPercent + 0.05);
      if (this.state.batteryPercent >= 100) this.state.charging = false;
    } else if (!this.state.usbConnected) {
      this.state.batteryPercent = Math.max(0, this.state.batteryPercent - 0.08);
    }
    const pct = Math.round(this.state.batteryPercent);
    const voltage = +(3.3 + (pct / 100) * 0.9).toFixed(2); // ~3.3V boş, ~4.2V dolu

    // --- Sinyal gücü hafif dalgalansın ---
    this.state.rssi = this._clamp(this.state.rssi + this._noise(2), -95, -40);

    // --- Boş bellek hafif dalgalansın ---
    this.state.freeHeap = Math.round(this._clamp(this.state.freeHeap + this._noise(1500), 90000, 180000));

    // --- Akım (mA): alarmda buzzer yüzünden daha yüksek ---
    const currentMa = Math.round((flameDetected ? 180 : 95) + this._noise(15));

    // --- Şemaya uygun durum nesnesi ---
    const status = {
      deviceId: this.device.id,
      online: true,
      timestamp: now,
      uptimeSec: now - this.state.bootTime,
      firmware: '1.0.0',
      flame: {
        detected: flameDetected,
        sensorActive: this.state.sensorActive,
      },
      buzzer: flameDetected, // firmware'de alev = buzzer açık
      power: {
        usbConnected: this.state.usbConnected,
        charging: this.state.charging,
        batteryPercent: pct,
        batteryVoltage: voltage,
        currentMa,
      },
      wifi: { rssi: Math.round(this.state.rssi) },
      system: { freeHeap: this.state.freeHeap },
    };

    if (this.onStatus) this.onStatus(status);
  }

  /**
   * Geçmiş alarm listesi üretir (grafikler + olay günlüğü için).
   * @param {string} range '1h' | '24h' | '7d' | '30d'
   * @returns {Promise<Array>} { id, start, end, durationSec } dizisi
   */
  async fetchAlarmHistory(range = '24h') {
    const now = Math.floor(Date.now() / 1000);
    const spanSec = { '1h': 3600, '24h': 86400, '7d': 604800, '30d': 2592000 }[range] || 86400;

    // Aralığa göre makul sayıda rastgele alarm üret
    const count = { '1h': 3, '24h': 14, '7d': 40, '30d': 120 }[range] || 14;

    const alarms = [];
    for (let i = 0; i < count; i++) {
      const start = now - Math.floor(Math.random() * spanSec);
      const durationSec = 5 + Math.floor(Math.random() * 90);
      alarms.push({
        id: i + 1,
        start,
        end: start + durationSec,
        durationSec,
      });
    }
    // En yeni en üstte
    alarms.sort((a, b) => b.start - a.start);
    alarms.forEach((a, i) => (a.id = alarms.length - i));

    // Gerçek ağ gecikmesini taklit et
    await this._delay(200);
    return alarms;
  }

  /**
   * Uzaktan komutu taklit eder. 'test' komutu kısa bir alarm tetikler.
   * @returns {Promise<{ok:boolean}>}
   */
  async sendCommand(command) {
    await this._delay(250);
    if (command === 'test') {
      const now = Math.floor(Date.now() / 1000);
      this.state.flameUntil = now + 6; // 6 sn test alarmı
    }
    if (command === 'mute') {
      this.state.flameUntil = 0; // alarmı hemen sustur
    }
    if (command === 'restart') {
      // Kısa bir "çevrimdışı" simülasyonu: bir sonraki tick'leri 3 sn duraklat
      this.stop();
      setTimeout(() => this.start(this.onStatus), 3000);
      this.state.bootTime = Math.floor(Date.now() / 1000); // uptime sıfırlanır
    }
    return { ok: true };
  }

  // --- küçük yardımcılar ---
  _noise(amp) { return (Math.random() - 0.5) * 2 * amp; }
  _clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  _delay(ms) { return new Promise((r) => setTimeout(r, ms)); }
}

window.MockSource = MockSource;
