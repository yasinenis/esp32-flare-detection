# ESP32 Alev Algılama Sistemi (Flare Detection)

Bu proje, ESP32 (LilyGO TTGO T-Beam) kullanılarak geliştirilmiş bir alev (yangın) algılama sistemidir. Ortamda alev tespit edildiğinde hem sesli (buzzer) hem de görsel (OLED ekran) olarak uyarı verir.

cd dashboard
python3 -m http.server 8080
http://localhost:8080

## 📸 Görseller ve Demo

**Proje Fotoğrafı:**
<img width="2040" height="1536" alt="picture" src="https://github.com/user-attachments/assets/218d510d-bbd4-4884-bc74-82b50e9d5d67" />

**Demo Videosu:**
[🎬 Projenin Çalışma Videosunu İzlemek İçin Tıklayın](https://github.com/user-attachments/assets/5106c5d3-cd30-4685-98a4-474bc7f61504)

## 🚀 Özellikler

- **Gerçek Zamanlı Alev Algılama**: Alev sensörü ile ortamdaki ateş ve alevleri hızlıca tespit eder.
- **Sesli Uyarı (Buzzer)**: Alev algılandığında aktif buzzer devreye girer.
- **Görsel Uyarı (OLED Ekran)**: 
  - Normal durumda ekranda tam boyutta bir "Kalkan ve Tik (GÜVENLİ)" ikonu gösterilir.
  - Alev algılandığında ekranda dinamik olarak çizilmiş tam boyutlu "Alev (FIRE!)" ikonu belirir.
- **Güç Yönetimi (AXP192)**: T-Beam üzerindeki PMU (Power Management Unit) AXP192 i2c üzerinden konfigüre edilerek OLED ve diğer birimlerin güç rayları aktif edilir.
- **Framebuffer Tabanlı Çizim**: OLED ekran (SSD1306) üzerine grafikler özel bir framebuffer mantığı ile doğrudan pikseller bazında çizilir.

## 🛠️ Donanım Gereksinimleri

- **LilyGO TTGO T-Beam** (ESP32 Tabanlı geliştirme kartı, AXP192 PMU içerir)
- **Alev Sensörü (Flame Sensor)** (Dijital çıkış veren standart modül)
- **HW-508 Aktif Buzzer Modülü**
- **0.96" I2C OLED Ekran (SSD1306)**
- Breadboard ve Jumper Kablolar

## 🔌 Bağlantı Şeması

| Bileşen | Pin | ESP32 (T-Beam) Bağlantısı | Notlar |
| :--- | :--- | :--- | :--- |
| **Alev Sensörü** | VCC | 3.3V (Breadboard) | - |
| | GND | GND (Breadboard) | - |
| | DO | GPIO 13 (INPUT) | Dijital Sinyal |
| **HW-508 Buzzer** | (+) VCC | GPIO 25 (OUTPUT) | Güç kontrolü doğrudan GPIO'dan sağlanır (Active-High) |
| | (-) GND | GND (Breadboard) | - |
| | I/SIG | Boş | Kullanılmıyor |
| **OLED Ekran** | VCC | 3.3V (Breadboard) | AXP192 LDO2 üzerinden |
| | GND | GND (Breadboard) | - |
| | SDA | GPIO 21 | I2C Veri |
| | SCL | GPIO 22 | I2C Saat |

> **Önemli Not:** HW-508 aktif buzzer sürekli ötme probleminden dolayı VCC pini doğrudan GPIO 25'e bağlanmıştır. Sinyal (I/SIG) pini boş bırakılmalıdır. ESP32 GPIO 25 pinini `HIGH` yaptığında buzzer öter, `LOW` yaptığında susar.

## 💻 Kurulum ve Derleme (ESP-IDF)

Proje **ESP-IDF** (Espressif IoT Development Framework) kullanılarak C dili ile yazılmıştır.

1. ESP-IDF ortamınızı bilgisayarınıza kurun.
2. Projeyi klonlayın:
   ```bash
   git clone <repo_url>
   cd esp32-flare-detection
   ```
3. Hedef işlemciyi ayarlayın (ESP32):
   ```bash
   idf.py set-target esp32
   ```
4. Derleyin ve karta yükleyin:
   ```bash
   idf.py build flash monitor
   ```

## 🌐 Web Dashboard (Gerçek Zamanlı İzleme Paneli)

Cihaz artık WiFi'ye bağlanıp durum verisini **WebSocket** ile canlı yayınlar; bir web
kontrol paneli ([dashboard/](dashboard/)) bu veriyi gerçek zamanlı gösterir (alarm
durumu, pil/güç, sinyal, alarm geçmişi grafikleri, olay günlüğü, uzaktan komut).

### Cihaz tarafı kurulum (firmware)
1. **WiFi bilgilerinizi girin** — bunlar GitHub'a gitmeyen `secrets.h` dosyasında tutulur:
   ```bash
   # main/secrets.example.h şablonunu kopyalayın:
   cp main/secrets.example.h main/secrets.h
   ```
   Ardından [main/secrets.h](main/secrets.h) içine WiFi adı/şifrenizi yazın:
   ```c
   #define WIFI_SSID  "WIFI_ADINIZ"
   #define WIFI_PASS  "WIFI_SIFRENIZ"
   ```
   > `secrets.h`, `.gitignore` ile yok sayılır → şifreniz **asla** depoya/GitHub'a gitmez.
   > Cihaz adını değiştirmek isterseniz `DEVICE_ID`, [main/main.c](main/main.c) içindedir
   > (panel `CONFIG.devices[].id` ile aynı olmalı).
2. Derleyip yükleyin: `idf.py build flash monitor`
3. Seri çıktıda cihazın IP'sini görün (örn. `IP: 192.168.1.50`).

> ⚠️ `secrets.h` yoksa derleme bilinçli olarak durur ve sizi uyarır (örnek dosyayı kopyalamanız için).

> WebSocket sunucu desteği (`CONFIG_HTTPD_WS_SUPPORT`) `sdkconfig` + `sdkconfig.defaults`
> içinde açıldı. `sdkconfig`'i sıfırdan üretirseniz `sdkconfig.defaults` bunu korur.

### Panel tarafı kurulum
1. [dashboard/js/config.js](dashboard/js/config.js) içinde:
   ```js
   mockMode: false,
   websocket: { url: 'ws://192.168.1.50/ws' },  // cihazın IP'si
   http:      { baseUrl: 'http://192.168.1.50' },
   ```
2. Paneli çalıştırın: `cd dashboard && python3 -m http.server 8080` → `http://localhost:8080`

Cihazın sunduğu uç noktalar: `ws://<IP>/ws` (canlı durum + komut), `GET /api/status`,
`GET /api/alarms`, `POST /api/command`. Ayrıntılar: [dashboard/README.md](dashboard/README.md).

## 📂 Proje Yapısı

- `main/main.c`: I2C, AXP192 (PMU) başlatma + güç okuma, OLED framebuffer grafikleri, alev algılama, **WiFi (STA) + SNTP + WebSocket/HTTP sunucu** ve JSON üretimi.
- `main/CMakeLists.txt`: ağ bileşenleri (`esp_wifi`, `esp_http_server`, `json` vb.) eklenmiş bileşen kaydı.
- `sdkconfig.defaults`: WebSocket sunucu desteğini (`CONFIG_HTTPD_WS_SUPPORT`) kalıcı kılan varsayılanlar.
- `dashboard/`: Gerçek zamanlı web izleme paneli (HTML + Tailwind + vanilla JS, Chart.js).
- `bağlantıl-şemasi.md`: Alternatif ve detaylı bağlantı notları.
- `.gitignore`: ESP-IDF derleme dosyalarının ve IDE ayarlarının git'e atılmasını engelleyen kurallar.

## 📝 Lisans

Bu proje açık kaynaklıdır ve dilediğiniz gibi geliştirmeye açıktır.
