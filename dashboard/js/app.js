/**
 * ============================================================================
 *  app.js — Ana uygulama orkestrasyonu
 *  ----------------------------------------------------------------------------
 *  • Bağlantı yöneticisinden gelen durum verisini tüm widget'lara dağıtır.
 *  • Alarm geçiş mantığı, sesli/görsel uyarı, çevrimdışı tespiti.
 *  • Tema/dil, uzaktan kontrol, CSV dışa aktarma, onay, ayarlar.
 *
 *  Not: Bağlantı/şema ayarlarını DEĞİŞTİRMEK için js/config.js dosyasına bakın.
 *       Bu dosya yalnızca arayüz davranışını yönetir.
 * ============================================================================
 */

(() => {
  'use strict';

  /* ====================================================================== */
  /*  Durum (state)                                                         */
  /* ====================================================================== */
  const LS_KEY = 'flareDash.settings';

  const state = {
    settings: loadSettings(),
    currentDeviceId: CONFIG.devices[0]?.id || null,
    statuses: {},        // deviceId -> son durum nesnesi
    lastSeenMs: {},      // deviceId -> son veri zamanı (ms)
    online: {},          // deviceId -> bool
    alarms: [],          // olay günlüğü: {uid,id,deviceId,type,start,end,durationSec,acknowledged,ackBy,ackAt,isNew}
    telemetry: {},       // deviceId -> [{t, voltage, rssi}]
    prevDetected: {},    // deviceId -> bool (alev geçişi tespiti)
    prevUsb: {},         // deviceId -> bool (güç kesintisi tespiti)
    activeAlarmUid: {},  // deviceId -> aktif (açık) alarmın uid'i
    range: '24h',
    liveCounter: 1,
  };

  const conn = new ConnectionManager();
  const sound = new AlarmSound();

  /* ====================================================================== */
  /*  Başlatma                                                              */
  /* ====================================================================== */
  function init() {
    // Tema & dil
    applyTheme(state.settings.theme);
    setLanguage(state.settings.language);

    // Sesli alarm ayarları
    sound.setEnabled(state.settings.soundEnabled);
    sound.setVolume(state.settings.soundVolume);

    // İlk kullanıcı etkileşiminde ses kilidini aç (otomatik oynatma politikası)
    const unlock = () => { sound.unlock(); window.removeEventListener('pointerdown', unlock); };
    window.addEventListener('pointerdown', unlock);

    buildDeviceSelect();
    syncSettingsUI();
    if (CONFIG.mockMode) document.getElementById('mockBadge').classList.remove('hidden');

    Charts.init();
    Charts.setTheme(state.settings.theme);

    wireEvents();

    // Bağlantı olayları
    conn.on('status', onStatus);
    conn.on('transport', (tp) => { document.getElementById('footProtocol').textContent = tp; });
    conn.on('error', (e) => console.warn('[conn]', e));
    conn.connect();

    loadAlarmHistory();

    // Çevrimdışı tazelik denetimi + "son görülme" sayacı (her saniye)
    setInterval(tickFreshness, 1000);

    lucide.createIcons();
  }

  /* ====================================================================== */
  /*  Durum verisi geldiğinde                                               */
  /* ====================================================================== */
  function onStatus(status) {
    const id = status.deviceId;
    state.statuses[id] = status;
    state.lastSeenMs[id] = Date.now();
    const wasOnline = state.online[id];
    state.online[id] = true;

    // Telemetri geçmişi (trend grafiği)
    pushTelemetry(id, status);

    // Güç kesintisi olayı: USB true -> false
    if (state.prevUsb[id] === true && status.power.usbConnected === false) {
      addEvent(id, 'power', status.timestamp, status.timestamp, 0);
    }
    state.prevUsb[id] = status.power.usbConnected;

    // Alev geçişleri (gerçek cihazda da çalışır)
    handleFlameTransition(id, status);

    // Yalnızca seçili cihaz arayüze yansır
    if (id === state.currentDeviceId) {
      renderAll(status);
      if (!wasOnline) { loadAlarmHistory(); } // tekrar çevrimiçi olunca geçmişi tazele
    }
  }

  /** flame.detected geçişlerini yakalar; alarm açar/kapatır, ses/bildirim tetikler. */
  function handleFlameTransition(id, status) {
    const detected = !!status.flame.detected;
    const prev = !!state.prevDetected[id];

    if (detected && !prev) {
      // --- ALARM BAŞLADI ---
      const uid = 'L' + (state.liveCounter++);
      state.activeAlarmUid[id] = uid;
      state.alarms.unshift({
        uid, id: nextDisplayId(), deviceId: id, type: 'flame',
        start: status.timestamp, end: null, durationSec: null,
        acknowledged: false, ackBy: null, ackAt: null, isNew: true,
      });

      if (id === state.currentDeviceId) {
        triggerAlarmEffects(status);
        renderLog(); renderStats(); renderCharts();
      }
    } else if (!detected && prev) {
      // --- ALARM BİTTİ ---
      closeActiveAlarm(id, status.timestamp);
      if (id === state.currentDeviceId) {
        clearAlarmEffects();
        renderLog(); renderStats(); renderCharts();
      }
    }
    state.prevDetected[id] = detected;
  }

  function closeActiveAlarm(id, endTs) {
    const uid = state.activeAlarmUid[id];
    if (!uid) return;
    const a = state.alarms.find((x) => x.uid === uid);
    if (a && a.end === null) {
      a.end = endTs;
      a.durationSec = Math.max(0, endTs - a.start);
    }
    state.activeAlarmUid[id] = null;
  }

  /* ====================================================================== */
  /*  Alarm efektleri (ses + görsel + bildirim)                            */
  /* ====================================================================== */
  function triggerAlarmEffects(status) {
    document.body.classList.add('alarm-active');
    sound.start();
    // Tarayıcı bildirimi
    if (state.settings.notificationsEnabled) {
      const dev = deviceName(status.deviceId);
      BrowserNotify.notify(t('notifAlarmTitle'), `${dev} ${t('notifAlarmBody')}`);
    }
  }
  function clearAlarmEffects() {
    document.body.classList.remove('alarm-active');
    sound.stop();
  }

  /* ====================================================================== */
  /*  Tüm widget'ları çiz                                                   */
  /* ====================================================================== */
  function renderAll(status) {
    renderAlarmPanel(status);
    renderStatusCards(status);
    renderFooter(status);
    renderTrend();
  }

  /* ---- 2) Ana alarm paneli ---- */
  function renderAlarmPanel(status) {
    const panel = document.getElementById('alarmPanel');
    const icon = document.getElementById('alarmIcon');
    const title = document.getElementById('alarmTitle');
    const sub = document.getElementById('alarmSubtitle');

    panel.classList.remove('safe', 'alarm', 'waiting');
    if (status.flame.detected) {
      panel.classList.add('alarm');
      icon.textContent = '🔥';
      title.textContent = t('alarmTitle');
      sub.textContent = t('alarmSubtitle');
    } else {
      panel.classList.add('safe');
      icon.textContent = '🛡️';
      title.textContent = t('safeTitle');
      sub.textContent = t('safeSubtitle');
    }
  }

  function setPanelWaiting() {
    const panel = document.getElementById('alarmPanel');
    panel.classList.remove('safe', 'alarm');
    panel.classList.add('waiting');
    document.getElementById('alarmIcon').textContent = '⏳';
    document.getElementById('alarmTitle').textContent = t('waitingTitle');
    document.getElementById('alarmSubtitle').textContent = t('waitingSubtitle');
    clearAlarmEffects();
  }

  /* ---- 3) Durum kartları ---- */
  function renderStatusCards(s) {
    // Dedektör
    setCardState('cardDetector', s.flame.sensorActive ? 'safe' : 'danger');
    setText('detectorValue', s.flame.sensorActive ? t('detectorActive') : t('detectorFault'),
      s.flame.sensorActive ? 'c-safe' : 'c-danger');

    // Buzzer
    setCardState('cardBuzzer', s.buzzer ? 'danger' : 'gray');
    setText('buzzerValue', s.buzzer ? t('buzzerOn') : t('buzzerOff'), s.buzzer ? 'c-danger' : 'c-gray');

    // Güç kaynağı
    const usb = s.power.usbConnected;
    setCardState('cardPower', usb ? 'safe' : 'warn');
    setText('powerValue', usb ? t('powerUsb') : t('powerBattery'), usb ? 'c-safe' : 'c-warn');
    setIcon('powerIcon', usb ? 'plug-zap' : 'battery', usb ? 'c-safe' : 'c-warn');
    document.getElementById('powerSub').textContent = `${s.power.currentMa} mA`;

    // Pil
    renderBattery(s.power);

    // WiFi
    renderWifi(s.wifi.rssi);

    // Uptime
    setText('uptimeValue', fmtUptime(s.uptimeSec));

    // Sistem sağlığı
    setNum('heapValue', s.system.freeHeap / 1024, { decimals: 0 });
    document.getElementById('fwValue').textContent = `${t('firmware')} v${s.firmware}`;
  }

  function renderBattery(p) {
    const pct = p.batteryPercent;
    const low = pct < state.settings.lowBatteryThreshold;
    const color = low ? 'var(--danger)' : (pct < 50 ? 'var(--warn)' : 'var(--safe)');
    const cls = low ? 'c-danger' : (pct < 50 ? 'c-warn' : 'c-safe');

    setNum('battPercent', pct, { decimals: 0 });
    const fill = document.getElementById('battFill');
    fill.style.width = Math.max(4, Math.min(100, pct)) + '%';
    fill.style.background = color;

    const batt = document.getElementById('batt');
    batt.className = 'batt ' + cls + (p.charging ? ' charging' : '');
    setCardState('cardBattery', low ? 'danger' : (pct < 50 ? 'warn' : 'safe'));

    // Alt yazı: voltaj (+ şarj durumu)
    const sub = document.getElementById('battSub');
    sub.textContent = `${p.batteryVoltage.toFixed(2)} V` + (p.charging ? ` • ⚡ ${t('charging')}` : '');
    sub.className = 'metric-sub ' + (p.charging ? 'c-safe' : '');
  }

  function renderWifi(rssi) {
    // RSSI -> çubuk sayısı + etiket + renk
    let bars, label, cls, stateCls;
    if (rssi >= -60)      { bars = 4; label = t('signalStrong'); cls = 'c-safe';   stateCls = 'safe'; }
    else if (rssi >= -70) { bars = 3; label = t('signalStrong'); cls = 'c-safe';   stateCls = 'safe'; }
    else if (rssi >= -80) { bars = 2; label = t('signalMedium'); cls = 'c-warn';   stateCls = 'warn'; }
    else                  { bars = 1; label = t('signalWeak');   cls = 'c-danger'; stateCls = 'danger'; }

    const spans = document.querySelectorAll('#wifiBars span');
    spans.forEach((sp, i) => {
      sp.classList.toggle('on', i < bars);
      sp.style.background = i < bars ? `var(--${stateCls === 'safe' ? 'safe' : stateCls === 'warn' ? 'warn' : 'danger'})` : '';
    });
    setText('wifiValue', label, cls);
    document.getElementById('wifiSub').textContent = `${rssi} dBm`;
    setCardState('cardWifi', stateCls);
  }

  /* ---- 5) İstatistik kartları ---- */
  function renderStats() {
    const flames = state.alarms.filter((a) => a.type === 'flame' && a.deviceId === state.currentDeviceId);
    const now = Date.now() / 1000;
    const dayAgo = now - 86400, weekAgo = now - 604800;

    const todayCount = flames.filter((a) => a.start >= dayAgo).length;
    const weekCount = flames.filter((a) => a.start >= weekAgo).length;
    setNum('statToday', todayCount, { decimals: 0 });
    setNum('statWeek', weekCount, { decimals: 0 });

    // En son alarm
    const last = flames[0]; // dizide en yeni başta
    const lastEl = document.getElementById('statLast');
    if (last) {
      const lastStatus = state.statuses[state.currentDeviceId];
      const refNowSec = lastStatus ? lastStatus.timestamp : undefined;
      lastEl.textContent = fmtRelative(last.start, refNowSec);
      lastEl.setAttribute('title', fmtDateTime(last.start));
    } else {
      lastEl.textContent = t('never');
      lastEl.setAttribute('title', '');
    }

    // En uzun alarm
    const durations = flames.map((a) => a.durationSec || 0);
    const longest = durations.length ? Math.max(...durations) : 0;
    document.getElementById('statLongest').textContent = longest ? fmtDuration(longest) : '—';
  }

  /* ---- 6) Olay günlüğü tablosu ---- */
  function renderLog() {
    const body = document.getElementById('logBody');
    const rows = state.alarms.filter((a) => a.deviceId === state.currentDeviceId);

    if (rows.length === 0) {
      body.innerHTML = `<tr><td colspan="6" class="text-center text-faint py-8">${t('logEmpty')}</td></tr>`;
      return;
    }

    body.innerHTML = rows.map((a) => {
      const badge = {
        flame:   `<span class="badge badge-flame"><i data-lucide="flame" class="w-3 h-3"></i>${t('typeFlame')}</span>`,
        power:   `<span class="badge badge-power"><i data-lucide="zap-off" class="w-3 h-3"></i>${t('typePower')}</span>`,
        offline: `<span class="badge badge-offline"><i data-lucide="wifi-off" class="w-3 h-3"></i>${t('typeOffline')}</span>`,
      }[a.type] || a.type;

      const endTxt = a.end ? fmtDateTime(a.end) : `<span class="c-danger">${t('ongoing')}</span>`;
      const durTxt = a.durationSec != null ? fmtDuration(a.durationSec) : '—';

      let action;
      if (a.acknowledged) {
        action = `<span class="badge badge-ack" title="${t('ackedBy')}: ${a.ackBy} • ${fmtDateTime(a.ackAt)}">
                    <i data-lucide="check" class="w-3 h-3"></i>${t('acknowledged')}</span>`;
      } else {
        action = `<button class="btn !py-1 !px-2 text-xs ack-btn" data-uid="${a.uid}">
                    <i data-lucide="check-check" class="w-3 h-3"></i>${t('acknowledge')}</button>`;
      }

      return `<tr class="${a.isNew ? 'log-row-new' : ''}">
        <td class="tnum text-faint">${a.id}</td>
        <td class="tnum">${fmtDateTime(a.start)}</td>
        <td class="tnum">${endTxt}</td>
        <td class="tnum">${durTxt}</td>
        <td>${badge}</td>
        <td>${action}</td>
      </tr>`;
    }).join('');

    // "yeni" işaretini bir kez gösterdikten sonra kaldır
    rows.forEach((a) => (a.isNew = false));
    lucide.createIcons();
  }

  /* ---- Grafikler ---- */
  function renderCharts() {
    const flames = state.alarms.filter((a) => a.type === 'flame' && a.deviceId === state.currentDeviceId);
    const lastStatus = state.statuses[state.currentDeviceId];
    const refNowSec = lastStatus ? lastStatus.timestamp : undefined;
    Charts.renderAlarmCount(flames, state.range, refNowSec);
    Charts.renderTimeline(flames);
  }
  function renderTrend() {
    Charts.renderTrend(state.telemetry[state.currentDeviceId] || []);
  }

  /* ---- 9) Footer ---- */
  function renderFooter(s) {
    document.getElementById('footDevice').textContent = s.deviceId;
    document.getElementById('footFirmware').textContent = 'v' + s.firmware;
    document.getElementById('footLastData').textContent = fmtDateTime(s.timestamp);
  }

  /* ====================================================================== */
  /*  Çevrimdışı tazelik denetimi + "son görülme"                          */
  /* ====================================================================== */
  function tickFreshness() {
    const id = state.currentDeviceId;
    const seen = state.lastSeenMs[id];
    const dot = document.getElementById('connDot');
    const text = document.getElementById('connText');
    const lastSeenEl = document.getElementById('lastSeen');

    if (!seen) {
      setOffline(); setPanelWaiting();
      lastSeenEl.textContent = '—';
      return;
    }

    const ageSec = Math.floor((Date.now() - seen) / 1000);
    lastSeenEl.textContent = ageSec < 2
      ? `${t('lastSeen')}: ${t('justNow')}`
      : `${t('lastSeen')}: ${ageSec} ${t('secondsAgo')}`;

    if (ageSec > CONFIG.offlineThresholdSec) {
      if (state.online[id]) {
        // Yeni çevrimdışı oldu: aktif alarmı kapat, efektleri durdur
        state.online[id] = false;
        closeActiveAlarm(id, Math.floor(seen / 1000));
        addEvent(id, 'offline', Math.floor(seen / 1000), Math.floor(seen / 1000), 0);
        renderLog(); renderStats(); renderCharts();
      }
      setOffline();
      setPanelWaiting();
    } else {
      setOnlineUI();
    }

    function setOffline() {
      dot.className = 'conn-dot conn-offline';
      text.textContent = t('offline');
      text.className = 'font-display font-bold text-sm c-danger';
    }
    function setOnlineUI() {
      dot.className = 'conn-dot conn-online';
      text.textContent = t('online');
      text.className = 'font-display font-bold text-sm c-safe';
    }
  }

  /* ====================================================================== */
  /*  Alarm geçmişi (REST / mock)                                          */
  /* ====================================================================== */
  async function loadAlarmHistory() {
    const id = state.currentDeviceId;
    const history = await conn.fetchAlarmHistory(id, state.range);

    // Geçmiş kayıtları olay nesnesine çevir (type: flame)
    const historyEvents = history.map((h) => ({
      uid: 'H' + id + '-' + h.id,
      id: h.id,
      deviceId: id,
      type: 'flame',
      start: h.start,
      end: h.end,
      durationSec: h.durationSec,
      acknowledged: false, ackBy: null, ackAt: null, isNew: false,
    }));

    // Bu cihazın CANLI olaylarını (L=alev, E=güç/çevrimdışı) koru;
    // yalnızca geçmiş kayıtlarını (H...) yenisiyle değiştir.
    const liveForOther = state.alarms.filter((a) => a.deviceId !== id);
    const liveForThis = state.alarms.filter((a) => a.deviceId === id && !String(a.uid).startsWith('H'));
    state.alarms = [...liveForThis, ...historyEvents, ...liveForOther]
      .sort((a, b) => b.start - a.start);

    renderLog(); renderStats(); renderCharts();
  }

  /* ====================================================================== */
  /*  Olaylar (event listeners)                                            */
  /* ====================================================================== */
  function wireEvents() {
    // Tema
    document.getElementById('themeBtn').addEventListener('click', () => {
      const next = state.settings.theme === 'dark' ? 'light' : 'dark';
      applyTheme(next); Charts.setTheme(next);
      state.settings.theme = next; saveSettings();
    });

    // Dil
    document.getElementById('langBtn').addEventListener('click', () => {
      const next = getLang() === 'tr' ? 'en' : 'tr';
      setLanguage(next);
      document.getElementById('langBtn').textContent = next.toUpperCase();
      state.settings.language = next; saveSettings();
      Charts.relabel();
      // Dile bağlı dinamik metinleri yeniden çiz
      const s = state.statuses[state.currentDeviceId];
      if (s && state.online[state.currentDeviceId]) renderAll(s); else setPanelWaiting();
      renderLog(); renderStats();
    });

    // Cihaz seçimi
    document.getElementById('deviceSelect').addEventListener('change', (e) => {
      switchDevice(e.target.value);
    });

    // Zaman aralığı
    document.querySelectorAll('.range-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.range-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.range = btn.dataset.range;
        loadAlarmHistory();
      });
    });

    // Uzaktan kontrol
    document.getElementById('muteBtn').addEventListener('click', () => doCommand('mute', t('cmdMute')));
    document.getElementById('testBtn').addEventListener('click', () => doCommand('test', t('cmdTest')));
    document.getElementById('restartBtn').addEventListener('click', openModal);
    document.getElementById('modalCancel').addEventListener('click', closeModal);
    document.getElementById('modalConfirm').addEventListener('click', () => {
      closeModal(); doCommand('restart', t('cmdRestart'));
    });
    document.getElementById('modalWrap').addEventListener('click', (e) => {
      if (e.target.id === 'modalWrap') closeModal();
    });

    // CSV dışa aktar
    document.getElementById('exportBtn').addEventListener('click', exportCsv);

    // Onayla (olay delegasyonu)
    document.getElementById('logBody').addEventListener('click', (e) => {
      const btn = e.target.closest('.ack-btn');
      if (btn) acknowledge(btn.dataset.uid);
    });

    // Ayar anahtarları
    document.getElementById('notifSwitch').addEventListener('click', toggleNotifications);
    document.getElementById('soundSwitch').addEventListener('click', toggleSound);
    document.getElementById('volume').addEventListener('input', (e) => {
      const v = +e.target.value;
      document.getElementById('volumeVal').textContent = v + '%';
      state.settings.soundVolume = v / 100;
      sound.setVolume(v / 100);
    });
    document.getElementById('volume').addEventListener('change', saveSettings);

    document.getElementById('saveSettingsBtn').addEventListener('click', () => {
      state.settings.telegram.botToken = document.getElementById('tgToken').value.trim();
      state.settings.telegram.chatId = document.getElementById('tgChat').value.trim();
      state.settings.email.to = document.getElementById('emailTo').value.trim();
      saveSettings();
      toast(t('settingsSaved'), 'ok');
    });
  }

  function switchDevice(id) {
    state.currentDeviceId = id;
    clearAlarmEffects();
    const s = state.statuses[id];
    if (s && state.online[id]) renderAll(s); else setPanelWaiting();
    loadAlarmHistory();
    renderTrend();
  }

  /* ---- Uzaktan komut + toast geri bildirim ---- */
  async function doCommand(command, label) {
    const res = await conn.sendCommand(state.currentDeviceId, command);
    if (res.ok) {
      toast(`${label}: ${t('cmdSent')}`, 'ok');
      sound.beep(880, 90);
    } else {
      toast(`${label}: ${t('cmdFailed')}`, 'err');
    }
  }

  /* ---- Onayla ---- */
  function acknowledge(uid) {
    const a = state.alarms.find((x) => x.uid === uid);
    if (!a) return;
    if (!state.settings.operator) {
      const name = prompt(getLang() === 'tr' ? 'Onaylayan kişi adı:' : 'Operator name:', 'Operatör');
      state.settings.operator = (name && name.trim()) || 'Operatör';
      saveSettings();
    }
    a.acknowledged = true;
    a.ackBy = state.settings.operator;
    a.ackAt = Math.floor(Date.now() / 1000);
    renderLog();
    toast(t('acknowledged'), 'ok');
  }

  /* ---- CSV dışa aktarma ---- */
  function exportCsv() {
    const rows = state.alarms.filter((a) => a.deviceId === state.currentDeviceId);
    const header = ['#', 'deviceId', 'type', 'start', 'end', 'durationSec', 'acknowledged', 'ackBy', 'ackAt'];
    const lines = [header.join(',')];
    rows.forEach((a) => {
      lines.push([
        a.id, a.deviceId, a.type,
        new Date(a.start * 1000).toISOString(),
        a.end ? new Date(a.end * 1000).toISOString() : '',
        a.durationSec ?? '',
        a.acknowledged ? 'true' : 'false',
        a.ackBy || '', a.ackAt ? new Date(a.ackAt * 1000).toISOString() : '',
      ].join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `alev-olay-gunlugu-${state.currentDeviceId}-${state.range}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  /* ---- Bildirim ayarları ---- */
  async function toggleNotifications() {
    const sw = document.getElementById('notifSwitch');
    if (!state.settings.notificationsEnabled) {
      const perm = await BrowserNotify.request();
      if (perm === 'granted') {
        state.settings.notificationsEnabled = true;
        sw.classList.add('on');
        toast(t('notifEnabled'), 'ok');
      } else {
        toast(t('notifBlocked'), 'err');
      }
    } else {
      state.settings.notificationsEnabled = false;
      sw.classList.remove('on');
    }
    saveSettings();
  }

  function toggleSound() {
    const sw = document.getElementById('soundSwitch');
    state.settings.soundEnabled = !state.settings.soundEnabled;
    sw.classList.toggle('on', state.settings.soundEnabled);
    sound.setEnabled(state.settings.soundEnabled);
    saveSettings();
  }

  /* ---- Modal ---- */
  function openModal() { document.getElementById('modalWrap').classList.add('open'); }
  function closeModal() { document.getElementById('modalWrap').classList.remove('open'); }

  /* ====================================================================== */
  /*  Yardımcılar                                                          */
  /* ====================================================================== */
  function pushTelemetry(id, s) {
    if (!state.telemetry[id]) state.telemetry[id] = [];
    const arr = state.telemetry[id];
    arr.push({ t: s.timestamp, voltage: s.power.batteryVoltage, rssi: s.wifi.rssi });
    const max = CONFIG.defaults.telemetryHistoryLength;
    if (arr.length > max) arr.splice(0, arr.length - max);
  }

  function addEvent(id, type, start, end, durationSec) {
    state.alarms.unshift({
      uid: 'E' + (state.liveCounter++), id: nextDisplayId(), deviceId: id, type,
      start, end, durationSec, acknowledged: false, ackBy: null, ackAt: null, isNew: true,
    });
  }

  function nextDisplayId() {
    const ids = state.alarms.map((a) => a.id).filter((n) => typeof n === 'number');
    return (ids.length ? Math.max(...ids) : 0) + 1;
  }

  function buildDeviceSelect() {
    const sel = document.getElementById('deviceSelect');
    sel.innerHTML = CONFIG.devices.map((d) => `<option value="${d.id}">${d.name} (${d.id})</option>`).join('');
    sel.value = state.currentDeviceId;
  }
  function deviceName(id) {
    return (CONFIG.devices.find((d) => d.id === id) || {}).name || id;
  }

  function setCardState(cardId, st) {
    const el = document.getElementById(cardId);
    el.classList.remove('state-safe', 'state-danger', 'state-warn', 'state-gray');
    el.classList.add('state-' + st);
  }
  function setText(id, text, colorClass) {
    const el = document.getElementById(id);
    el.textContent = text;
    if (colorClass) el.className = el.className.replace(/c-(safe|danger|warn|gray|accent)/g, '').trim() + ' ' + colorClass;
  }
  function setIcon(id, name, colorClass) {
    const el = document.getElementById(id);
    el.setAttribute('data-lucide', name);
    // lucide.createIcons() <i> öğesini <svg>'e çevirir; SVGElement.className salt-okunurdur
    // (yalnızca getter), bu yüzden setAttribute('class', ...) kullanılmalı.
    el.setAttribute('class', (colorClass || '') + ' w-5 h-5');
    lucide.createIcons();
  }

  // Count-up animasyonu
  const numCache = {};
  function setNum(id, value, { decimals = 0 } = {}) {
    const el = document.getElementById(id);
    const from = numCache[id] ?? value;
    const to = value;
    numCache[id] = to;
    const dur = 500, t0 = performance.now();
    function step(now) {
      const k = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      const cur = from + (to - from) * eased;
      el.textContent = cur.toFixed(decimals);
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ---- Tema ---- */
  function applyTheme(theme) {
    state.settings.theme = theme;
    const html = document.documentElement;
    html.classList.toggle('dark', theme === 'dark');
    // Tema ikonu
    const btn = document.getElementById('themeBtn');
    btn.innerHTML = `<i data-lucide="${theme === 'dark' ? 'moon' : 'sun'}" class="w-5 h-5"></i>`;
    lucide.createIcons();
  }

  /* ---- Ayarlar (localStorage) ---- */
  function loadSettings() {
    const d = CONFIG.defaults;
    const base = {
      theme: d.theme, language: d.language,
      soundEnabled: d.soundEnabled, soundVolume: d.soundVolume,
      notificationsEnabled: false, lowBatteryThreshold: d.lowBatteryThreshold,
      operator: null,
      telegram: { ...CONFIG.integrations.telegram },
      email: { ...CONFIG.integrations.email },
    };
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      return { ...base, ...saved, telegram: { ...base.telegram, ...(saved.telegram || {}) }, email: { ...base.email, ...(saved.email || {}) } };
    } catch (_) { return base; }
  }
  function saveSettings() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state.settings)); } catch (_) {}
  }
  function syncSettingsUI() {
    document.getElementById('langBtn').textContent = (state.settings.language || 'tr').toUpperCase();
    document.getElementById('soundSwitch').classList.toggle('on', state.settings.soundEnabled);
    document.getElementById('notifSwitch').classList.toggle('on', state.settings.notificationsEnabled && BrowserNotify.status() === 'granted');
    const vol = Math.round(state.settings.soundVolume * 100);
    document.getElementById('volume').value = vol;
    document.getElementById('volumeVal').textContent = vol + '%';
    document.getElementById('tgToken').value = state.settings.telegram.botToken || '';
    document.getElementById('tgChat').value = state.settings.telegram.chatId || '';
    document.getElementById('emailTo').value = state.settings.email.to || '';
  }

  /* ---- Toast ---- */
  function toast(msg, type = 'info', ms = 3200) {
    const wrap = document.getElementById('toastWrap');
    const el = document.createElement('div');
    const icon = { ok: 'check-circle', err: 'x-circle', info: 'info' }[type] || 'info';
    el.className = 'toast ' + type;
    el.innerHTML = `<i data-lucide="${icon}" class="w-5 h-5"></i><span>${msg}</span>`;
    wrap.appendChild(el);
    lucide.createIcons();
    setTimeout(() => {
      el.style.transition = 'opacity .3s, transform .3s';
      el.style.opacity = '0'; el.style.transform = 'translateX(20px)';
      setTimeout(() => el.remove(), 300);
    }, ms);
  }

  /* ---- Zaman/biçim yardımcıları ---- */
  function fmtUptime(sec) {
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const L = getLang();
    const dd = L === 'tr' ? 'g' : 'd', hh = L === 'tr' ? 's' : 'h', mm = L === 'tr' ? 'd' : 'm';
    return (d > 0 ? `${d}${dd} ` : '') + `${String(h).padStart(2, '0')}${hh} ${String(m).padStart(2, '0')}${mm}`;
  }
  function fmtDuration(sec) {
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60), s = sec % 60;
    if (m < 60) return `${m}d ${s}s`;
    const h = Math.floor(m / 60);
    return `${h}s ${m % 60}d`;
  }
  function fmtDateTime(epochSec) {
    return new Date(epochSec * 1000).toLocaleString(getLang() === 'tr' ? 'tr-TR' : 'en-US',
      { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  function fmtRelative(epochSec, refNowSec) {
    // "Şimdi" referansı: mümkünse cihazın kendi son zaman damgası (NTP saati tarayıcıyla
    // senkron olmayabilir). Aksi halde alarm geleceğe düşüp "X sn sonra" görünebilir.
    // Artık küçük kaymalara karşı da farkı negatife düşürmeyiz.
    const now = refNowSec || Math.floor(Date.now() / 1000);
    const diff = Math.max(0, now - epochSec); // saniye
    const rtf = new Intl.RelativeTimeFormat(getLang() === 'tr' ? 'tr' : 'en', { numeric: 'auto' });
    if (diff < 60) return rtf.format(-diff, 'second');
    if (diff < 3600) return rtf.format(-Math.floor(diff / 60), 'minute');
    if (diff < 86400) return rtf.format(-Math.floor(diff / 3600), 'hour');
    return rtf.format(-Math.floor(diff / 86400), 'day');
  }

  // Başlat
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
