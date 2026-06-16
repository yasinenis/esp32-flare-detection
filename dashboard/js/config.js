/**
 * ============================================================================
 *  CONFIG — Tüm bağlantı ve davranış ayarları TEK YERDE.
 *  ----------------------------------------------------------------------------
 *  ESP32 tarafını kurarken DEĞİŞTİRMENİZ gereken her şey bu dosyadadır.
 *  Her ayarın yanında ne işe yaradığı yorumla açıklanmıştır.
 * ============================================================================
 */

const CONFIG = {
  // ==========================================================================
  // 1) TEST / GELİŞTİRME MODU
  // --------------------------------------------------------------------------
  //   mockMode: true   -> Gerçek cihaz OLMADAN sahte veri + ara sıra sahte
  //                       alarm üretir. Tüm arayüzü test etmek için idealdir.
  //   mockMode: false  -> Aşağıdaki transport ayarlarıyla GERÇEK cihaza bağlanır.
  // ==========================================================================
  mockMode: false,

  // ==========================================================================
  // 2) BİRİNCİL İLETİŞİM YÖNTEMİ
  // --------------------------------------------------------------------------
  //   'websocket' | 'mqtt' | 'http'
  //   'websocket' seçiliyse ve bağlantı kurulamazsa, otomatik olarak
  //   'http' polling'e (her CONFIG.http.pollIntervalMs ms) DÜŞER (fallback).
  // ==========================================================================
  primaryTransport: 'websocket',

  // ==========================================================================
  // 3) WEBSOCKET (birincil) — ESP32 üzerindeki WS sunucusu
  // --------------------------------------------------------------------------
  //   ESPAsyncWebServer ile tipik adres: ws://<ESP_IP>/ws
  //   Cihaz, durum JSON'unu (aşağıdaki şema) bu soket üzerinden gönderir.
  //   Dashboard komutları aynı soket üzerinden {type:'command', ...} olarak yollar.
  // ==========================================================================
  websocket: {
    url: 'ws://192.168.1.50/ws', // <-- ESP32'nizin IP'si ile değiştirin
    reconnectDelayMs: 3000,      // bağlantı koparsa kaç ms sonra tekrar denesin
  },

  // ==========================================================================
  // 4) MQTT over WebSocket (alternatif) — broker üzerinden çoklu cihaz
  // --------------------------------------------------------------------------
  //   Tarayıcı yalnızca WS/WSS üzerinden MQTT konuşabilir (TCP 1883 OLMAZ).
  //   Topic şeması:
  //     flare/device/{deviceId}/status   (cihaz  -> dashboard)  [abone olunur]
  //     flare/device/{deviceId}/command  (dashboard -> cihaz)   [publish edilir]
  // ==========================================================================
  mqtt: {
    brokerUrl: 'ws://broker.hivemq.com:8000/mqtt',       // WS/WSS broker adresi
    statusTopic: 'flare/device/+/status',                // + = tüm cihazlar
    commandTopicTemplate: 'flare/device/{deviceId}/command',
    username: '',                                         // gerekiyorsa doldurun
    password: '',                                         // gerekiyorsa doldurun
  },

  // ==========================================================================
  // 5) HTTP / REST (fallback + geçmiş veri)
  // --------------------------------------------------------------------------
  //   baseUrl: ESP32'nin ya da arka uç (backend) sunucunun kök adresi.
  //   Beklenen uç noktalar:
  //     GET  {baseUrl}/api/status            -> anlık durum (polling için)
  //     GET  {baseUrl}/api/alarms?range=24h  -> alarm geçmişi (dizi)
  //     POST {baseUrl}/api/command           -> uzaktan komut  {deviceId, command}
  // ==========================================================================
  http: {
    baseUrl: 'http://192.168.1.50', // <-- ESP32/backend kök adresi
    pollIntervalMs: 2000,           // polling sıklığı (ms) — varsayılan 2 sn
  },

  // ==========================================================================
  // 6) ÇEVRİMDIŞI EŞİĞİ
  // --------------------------------------------------------------------------
  //   Son veriden bu kadar SANİYE geçtiyse cihaz otomatik "ÇEVRİMDIŞI" sayılır.
  // ==========================================================================
  offlineThresholdSec: 10,

  // ==========================================================================
  // 7) CİHAZ LİSTESİ (çoklu cihaz desteği)
  // --------------------------------------------------------------------------
  //   Şimdilik tek cihaz, ama mimari birden fazlasını destekler.
  //   Yeni cihaz eklemek için listeye {id, name} ekleyin.
  // ==========================================================================
  devices: [
    { id: 'tbeam-01', name: 'T-Beam #1' },
    // { id: 'tbeam-02', name: 'T-Beam #2 (Mutfak)' },
  ],

  // ==========================================================================
  // 8) ARAYÜZ VARSAYILANLARI
  // ==========================================================================
  defaults: {
    theme: 'dark',                 // 'dark' | 'light' (varsayılan dark)
    language: 'tr',                // 'tr' | 'en'
    soundEnabled: true,            // sesli alarm açık mı
    soundVolume: 0.7,              // 0.0 .. 1.0
    notificationsEnabled: false,   // tarayıcı bildirimi (izin verilince aktif olur)
    lowBatteryThreshold: 20,       // bu %'nin altında kırmızı uyarı
    telemetryHistoryLength: 900,   // trend grafiği için tutulacak örnek sayısı
  },

  // ==========================================================================
  // 9) BİLDİRİM ENTEGRASYONU (BACKEND PLACEHOLDER)
  // --------------------------------------------------------------------------
  //   Bu alanlar SADECE arayüzde gösterilir ve tarayıcıda saklanır.
  //   Telegram/E-posta gönderimi GÜVENLİK gereği backend'de yapılmalıdır;
  //   token'ı asla istemci tarafında ifşa etmeyin. Burası entegrasyon için
  //   yer tutucudur — gerçek gönderimi kendi sunucunuzda gerçekleştirin.
  // ==========================================================================
  integrations: {
    telegram: { botToken: '', chatId: '' }, // TODO(backend): bot ile alarm gönder
    email: { to: '' },                      // TODO(backend): e-posta ile alarm gönder
  },
};

/**
 * ----------------------------------------------------------------------------
 *  CİHAZIN GÖNDERDİĞİ DURUM JSON ŞEMASI (sözleşme) — referans
 *  ESP32 tarafında ÜRETECEĞİNİZ JSON tam olarak bu yapıda olmalı:
 * ----------------------------------------------------------------------------
 *  {
 *    "deviceId": "tbeam-01",
 *    "online": true,
 *    "timestamp": 1718560000,        // unix epoch (saniye)
 *    "uptimeSec": 38211,
 *    "firmware": "1.0.0",
 *    "flame":  { "detected": false, "sensorActive": true },
 *    "buzzer": false,
 *    "power":  { "usbConnected": true, "charging": true,
 *                "batteryPercent": 87, "batteryVoltage": 4.05, "currentMa": 120 },
 *    "wifi":   { "rssi": -58 },
 *    "system": { "freeHeap": 142000 }
 *  }
 *
 *  ALARM GEÇMİŞİ ŞEMASI (GET /api/alarms cevabındaki her eleman):
 *  { "id": 12, "start": 1718559000, "end": 1718559045, "durationSec": 45 }
 * ----------------------------------------------------------------------------
 */

// Tarayıcıya aç (modül kullanmıyoruz; global scope yeterli)
window.CONFIG = CONFIG;
