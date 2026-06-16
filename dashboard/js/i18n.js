/**
 * ============================================================================
 *  i18n.js — Türkçe / İngilizce çeviri sözlüğü ve uygulama yardımcıları
 *  ----------------------------------------------------------------------------
 *  Varsayılan dil CONFIG.defaults.language ('tr').
 *  HTML'de çevrilecek öğeler:
 *     <span data-i18n="anahtar"></span>            -> metin
 *     <span data-i18n-title="anahtar"></span>      -> title (tooltip)
 *     <input data-i18n-placeholder="anahtar">      -> placeholder
 *  JS içinde:  t('anahtar')   -> aktif dildeki metni döndürür.
 * ============================================================================
 */

const I18N = {
  tr: {
    // --- Genel / üst bar ---
    appTitle: 'Alev Algılama Paneli',
    appSubtitle: 'Gerçek Zamanlı İzleme',
    online: 'ÇEVRİMİÇİ',
    offline: 'ÇEVRİMDIŞI',
    lastSeen: 'Son görülme',
    secondsAgo: 'sn önce',
    justNow: 'az önce',
    selectDevice: 'Cihaz seç',
    themeToggle: 'Tema değiştir',
    langToggle: 'Dil: Türkçe',

    // --- Ana alarm paneli ---
    safeTitle: 'GÜVENLİ',
    safeSubtitle: 'Alev Algılanmadı',
    alarmTitle: 'ALEV ALGILANDI!',
    alarmSubtitle: 'Acil durum — derhal kontrol edin',
    waitingTitle: 'VERİ BEKLENİYOR',
    waitingSubtitle: 'Cihazdan henüz veri alınmadı',

    // --- Durum kartları ---
    detector: 'Dedektör Durumu',
    detectorActive: 'AKTİF',
    detectorFault: 'PASİF / ARIZA',
    buzzer: 'Buzzer',
    buzzerOn: 'ÖTÜYOR',
    buzzerOff: 'Sessiz',
    powerSource: 'Güç Kaynağı',
    powerUsb: 'USB / Harici Güç',
    powerBattery: 'Pil ile Çalışıyor',
    battery: 'Pil Seviyesi',
    charging: 'Şarj oluyor',
    wifiSignal: 'WiFi Sinyali',
    signalStrong: 'Güçlü',
    signalMedium: 'Orta',
    signalWeak: 'Zayıf',
    uptime: 'Çalışma Süresi',
    systemHealth: 'Sistem Sağlığı',
    freeHeap: 'Boş Bellek',
    firmware: 'Yazılım',

    // --- İstatistik kartları ---
    statsToday: 'Bugünkü Alarm',
    statsWeek: 'Bu Haftaki Alarm',
    statsLast: 'En Son Alarm',
    statsLongest: 'En Uzun Alarm',
    never: 'Hiç',

    // --- Grafikler ---
    chartsTitle: 'Alarm Geçmişi',
    range1h: 'Son 1 saat',
    range24h: 'Son 24 saat',
    range7d: 'Son 7 gün',
    range30d: 'Son 30 gün',
    chartAlarmCount: 'Zamana Göre Alarm Sayısı',
    chartTimeline: 'Alarm Zaman Çizelgesi',
    chartTrend: 'Pil Voltajı & Sinyal Trendi',
    noData: 'Bu aralıkta veri yok',
    alarms: 'Alarm',
    voltage: 'Voltaj (V)',
    rssi: 'Sinyal (dBm)',

    // --- Olay günlüğü ---
    logTitle: 'Olay Günlüğü',
    colNo: '#',
    colStart: 'Başlangıç',
    colEnd: 'Bitiş',
    colDuration: 'Süre',
    colType: 'Olay Tipi',
    colActions: 'İşlem',
    exportCsv: 'CSV Dışa Aktar',
    acknowledge: 'Onayla',
    acknowledged: 'Onaylandı',
    ongoing: 'Devam ediyor',
    typeFlame: 'Alev',
    typePower: 'Güç Kesintisi',
    typeOffline: 'Çevrimdışı',
    logEmpty: 'Henüz olay kaydı yok',
    ackedBy: 'Onaylayan',

    // --- Uzaktan kontrol ---
    controlTitle: 'Uzaktan Kontrol',
    mute: "Buzzer'ı Sustur",
    testAlarm: 'Test Alarmı Çalıştır',
    restart: 'Cihazı Yeniden Başlat',
    confirmRestart: 'Cihaz yeniden başlatılsın mı?',
    confirmRestartBody: 'Cihaz birkaç saniye çevrimdışı kalacak. Devam edilsin mi?',
    cancel: 'Vazgeç',
    confirm: 'Evet, Başlat',
    cmdSent: 'Komut gönderildi',
    cmdFailed: 'Komut gönderilemedi (çevrimdışı?)',
    cmdMute: 'Susturma komutu',
    cmdTest: 'Test alarmı komutu',
    cmdRestart: 'Yeniden başlatma komutu',

    // --- Bildirim ayarları ---
    settingsTitle: 'Bildirim Ayarları',
    browserNotif: 'Tarayıcı Bildirimi',
    soundAlarm: 'Sesli Alarm',
    volume: 'Ses Seviyesi',
    notifBlocked: 'Tarayıcı bildirimleri engellendi',
    notifEnabled: 'Bildirimler açık',
    integrationsNote: 'Aşağıdaki alanlar backend entegrasyonu içindir (yer tutucu).',
    telegramToken: 'Telegram Bot Token',
    telegramChat: 'Telegram Chat ID',
    emailTo: 'E-posta Adresi',
    saveSettings: 'Ayarları Kaydet',
    settingsSaved: 'Ayarlar kaydedildi',

    // --- Footer ---
    footerDevice: 'Cihaz',
    footerFirmware: 'Yazılım',
    footerLastData: 'Son Veri',
    footerProtocol: 'Protokol',

    // --- Bildirim metinleri ---
    notifAlarmTitle: '🔥 ALEV ALGILANDI',
    notifAlarmBody: 'cihazında alev tespit edildi!',
    mockBadge: 'TEST MODU (sahte veri)',
  },

  en: {
    appTitle: 'Flame Detection Panel',
    appSubtitle: 'Real-Time Monitoring',
    online: 'ONLINE',
    offline: 'OFFLINE',
    lastSeen: 'Last seen',
    secondsAgo: 's ago',
    justNow: 'just now',
    selectDevice: 'Select device',
    themeToggle: 'Toggle theme',
    langToggle: 'Language: English',

    safeTitle: 'SAFE',
    safeSubtitle: 'No Flame Detected',
    alarmTitle: 'FLAME DETECTED!',
    alarmSubtitle: 'Emergency — check immediately',
    waitingTitle: 'WAITING FOR DATA',
    waitingSubtitle: 'No data received from device yet',

    detector: 'Detector Status',
    detectorActive: 'ACTIVE',
    detectorFault: 'INACTIVE / FAULT',
    buzzer: 'Buzzer',
    buzzerOn: 'SOUNDING',
    buzzerOff: 'Silent',
    powerSource: 'Power Source',
    powerUsb: 'USB / External',
    powerBattery: 'Running on Battery',
    battery: 'Battery Level',
    charging: 'Charging',
    wifiSignal: 'WiFi Signal',
    signalStrong: 'Strong',
    signalMedium: 'Medium',
    signalWeak: 'Weak',
    uptime: 'Uptime',
    systemHealth: 'System Health',
    freeHeap: 'Free Memory',
    firmware: 'Firmware',

    statsToday: "Today's Alarms",
    statsWeek: 'This Week',
    statsLast: 'Last Alarm',
    statsLongest: 'Longest Alarm',
    never: 'Never',

    chartsTitle: 'Alarm History',
    range1h: 'Last 1 hour',
    range24h: 'Last 24 hours',
    range7d: 'Last 7 days',
    range30d: 'Last 30 days',
    chartAlarmCount: 'Alarms Over Time',
    chartTimeline: 'Alarm Timeline',
    chartTrend: 'Battery Voltage & Signal Trend',
    noData: 'No data in this range',
    alarms: 'Alarms',
    voltage: 'Voltage (V)',
    rssi: 'Signal (dBm)',

    logTitle: 'Event Log',
    colNo: '#',
    colStart: 'Start',
    colEnd: 'End',
    colDuration: 'Duration',
    colType: 'Type',
    colActions: 'Action',
    exportCsv: 'Export CSV',
    acknowledge: 'Acknowledge',
    acknowledged: 'Acknowledged',
    ongoing: 'Ongoing',
    typeFlame: 'Flame',
    typePower: 'Power Loss',
    typeOffline: 'Offline',
    logEmpty: 'No events logged yet',
    ackedBy: 'By',

    controlTitle: 'Remote Control',
    mute: 'Mute Buzzer',
    testAlarm: 'Run Test Alarm',
    restart: 'Restart Device',
    confirmRestart: 'Restart the device?',
    confirmRestartBody: 'The device will be offline for a few seconds. Continue?',
    cancel: 'Cancel',
    confirm: 'Yes, Restart',
    cmdSent: 'Command sent',
    cmdFailed: 'Command failed (offline?)',
    cmdMute: 'Mute command',
    cmdTest: 'Test alarm command',
    cmdRestart: 'Restart command',

    settingsTitle: 'Notification Settings',
    browserNotif: 'Browser Notifications',
    soundAlarm: 'Audible Alarm',
    volume: 'Volume',
    notifBlocked: 'Browser notifications are blocked',
    notifEnabled: 'Notifications enabled',
    integrationsNote: 'The fields below are placeholders for backend integration.',
    telegramToken: 'Telegram Bot Token',
    telegramChat: 'Telegram Chat ID',
    emailTo: 'Email Address',
    saveSettings: 'Save Settings',
    settingsSaved: 'Settings saved',

    footerDevice: 'Device',
    footerFirmware: 'Firmware',
    footerLastData: 'Last Data',
    footerProtocol: 'Protocol',

    notifAlarmTitle: '🔥 FLAME DETECTED',
    notifAlarmBody: 'detected a flame!',
    mockBadge: 'TEST MODE (mock data)',
  },
};

// Aktif dil (app.js tarafından güncellenir)
let CURRENT_LANG = (window.CONFIG && CONFIG.defaults.language) || 'tr';

/** Aktif dildeki çeviriyi döndürür. Anahtar yoksa anahtarın kendisini döndürür. */
function t(key, lang = CURRENT_LANG) {
  return (I18N[lang] && I18N[lang][key]) || (I18N.tr[key]) || key;
}

/** Aktif dili değiştirir ve tüm [data-i18n*] öğelerini günceller. */
function setLanguage(lang) {
  CURRENT_LANG = I18N[lang] ? lang : 'tr';
  document.documentElement.setAttribute('lang', CURRENT_LANG);
  applyTranslations();
  return CURRENT_LANG;
}

/** DOM'daki tüm çeviri işaretli öğeleri aktif dile göre günceller. */
function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
  });
}

window.t = t;
window.setLanguage = setLanguage;
window.applyTranslations = applyTranslations;
window.getLang = () => CURRENT_LANG;
