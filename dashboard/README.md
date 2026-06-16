# 🔥 Alev Algılama — Gerçek Zamanlı İzleme Paneli (Web Dashboard)

ESP32 tabanlı (LilyGO TTGO T-Beam) alev/yangın algılama cihazından gelen verileri
**canlı** olarak gösteren bir IoT kontrol panelidir. Tanıtım sitesi değildir; SCADA
tarzı bir izleme arayüzüdür.

> Cihaz firmware'i için ana proje köküne (`../main/main.c`) ve `../README.md` dosyasına bakın.

## ✨ Özellikler

- **Gerçek zamanlı bağlantı:** WebSocket (birincil) → kopunca otomatik **HTTP polling** (2 sn) fallback. Alternatif olarak **MQTT over WebSocket**.
- **Çift dil:** Sağ üstteki `TR/EN` butonuyla anında Türkçe ⇄ İngilizce.
- **Dark/Light tema** (varsayılan: dark), glassmorphism + neon estetik.
- **Ana alarm paneli:** Güvenli (yeşil kalkan) / Alev (kırmızı, yanıp sönen, ekran kenarı pulse glow).
- **Sesli alarm** (Web Audio, dosya gerektirmez) + **tarayıcı bildirimi** (izinle).
- **Durum kartları:** dedektör, buzzer, güç kaynağı, pil (+voltaj/şarj), WiFi (RSSI çubukları), uptime, sistem sağlığı.
- **Grafikler (Chart.js):** zamana göre alarm sayısı, alarm timeline, pil voltajı & sinyal trendi. Aralık: 1s / 24s / 7g / 30g.
- **İstatistik kartları:** bugün, bu hafta, en son alarm (göreli + tooltip), en uzun alarm.
- **Olay günlüğü:** canlı satır ekleme, CSV dışa aktarma, **Onayla (Acknowledge)** (kim/ne zaman).
- **Uzaktan kontrol:** Buzzer'ı sustur, test alarmı, yeniden başlat (onay modalı) + toast geri bildirim.
- **Çoklu cihaz** mimarisi (üst bardaki dropdown).
- **Çevrimdışı tespiti:** veri 10 sn'den eskiyse otomatik "ÇEVRİMDIŞI" + zarif boş durum.
- **Mock mod:** gerçek cihaz olmadan sahte veri + ara sıra sahte alarm.

## 🚀 Çalıştırma

CDN'ler (Tailwind, Chart.js, Lucide, MQTT.js) kullanıldığı için **derleme adımı yoktur**.
Sadece bir statik sunucu yeterlidir (internet bağlantısı gerekir):

```bash
cd dashboard
python3 -m http.server 8080
# Tarayıcı: http://localhost:8080
```

İlk açılışta `js/config.js` içindeki `mockMode: true` sayesinde sahte verilerle
çalışır; hemen test edebilirsiniz. Sesli alarmın çalması için tarayıcı politikası
gereği sayfaya **bir kez tıklayın** (ses kilidini açar).

## ⚙️ Yapılandırma — `js/config.js`

Tüm bağlantı ayarları **tek dosyada** ve bol yorumludur. Gerçek cihaza geçmek için:

```js
const CONFIG = {
  mockMode: false,                 // sahte veriyi kapat
  primaryTransport: 'websocket',   // 'websocket' | 'mqtt' | 'http'
  websocket: { url: 'ws://<ESP_IP>/ws' },
  http:      { baseUrl: 'http://<ESP_IP>', pollIntervalMs: 2000 },
  mqtt:      { brokerUrl: 'ws://broker:8000/mqtt', statusTopic: 'flare/device/+/status' },
  offlineThresholdSec: 10,
  devices: [{ id: 'tbeam-01', name: 'T-Beam #1' }],
};
```

## 🔌 ESP32 Tarafının Uyması Gereken Sözleşme

### 1) Durum verisi (cihaz → dashboard)
WebSocket mesajı / MQTT `flare/device/{deviceId}/status` payload'ı / `GET /api/status` cevabı,
**tam olarak** bu JSON şemasında olmalı:

```json
{
  "deviceId": "tbeam-01",
  "online": true,
  "timestamp": 1718560000,
  "uptimeSec": 38211,
  "firmware": "1.0.0",
  "flame":  { "detected": false, "sensorActive": true },
  "buzzer": false,
  "power":  { "usbConnected": true, "charging": true, "batteryPercent": 87, "batteryVoltage": 4.05, "currentMa": 120 },
  "wifi":   { "rssi": -58 },
  "system": { "freeHeap": 142000 }
}
```

> İpucu: Mevcut firmware'de alev `GPIO13 == 0` iken algılanır ve buzzer (`GPIO25`) açılır.
> `power.*` değerleri **AXP192**'den (I2C 0x34) okunabilir; `wifi.rssi` ve `system.freeHeap`
> ESP-IDF API'leriyle (`esp_wifi_sta_get_ap_info`, `esp_get_free_heap_size`) alınır.

### 2) Alarm geçmişi
`GET /api/alarms?range=24h&deviceId=tbeam-01` → şu şemada **dizi** döndürmeli:

```json
[ { "id": 12, "start": 1718559000, "end": 1718559045, "durationSec": 45 } ]
```

### 3) Uzaktan komutlar (dashboard → cihaz)
`command` değeri: `"mute"` | `"test"` | `"restart"`.

| Transport | Komut nasıl gönderilir |
| :-- | :-- |
| WebSocket | `{"type":"command","deviceId":"tbeam-01","command":"mute"}` |
| MQTT | `flare/device/tbeam-01/command` topic'ine `mute` publish |
| HTTP | `POST /api/command`  →  `{"deviceId":"tbeam-01","command":"mute"}` |

## 📁 Dosya Yapısı

```
dashboard/
├── index.html            # Tüm bölümlerin yerleşimi + CDN'ler
├── css/dashboard.css     # Tema değişkenleri, glassmorphism, animasyonlar
└── js/
    ├── config.js         # ⭐ TÜM bağlantı/davranış ayarları (burayı düzenleyin)
    ├── i18n.js           # TR/EN çeviri sözlüğü
    ├── mock.js           # Sahte veri + sahte alarm üreteci (mockMode)
    ├── notifications.js  # Web Audio sesli alarm + tarayıcı bildirimi
    ├── connection.js     # WS/MQTT/HTTP bağlantı yöneticisi + fallback
    ├── charts.js         # Chart.js grafikleri
    └── app.js            # Ana orkestrasyon + widget güncelleme + kontroller
```

## 🔐 Notlar

- **Telegram/E-posta** alanları yalnızca arayüz yer tutucusudur. Token'ı istemcide
  ifşa etmeyin; gerçek gönderimi **backend** tarafında yapın (`config.js` içinde yorumlandı).
- Ayarlar (tema, dil, ses, bildirim, onaylayan kişi) tarayıcıda `localStorage`'da saklanır.
- Cihaz çevrimdışıyken arayüz **çökmemek** üzere zarifçe boş/bekleme durumuna geçer.
