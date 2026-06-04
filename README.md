# ESP32 Alev Algılama Sistemi (Flare Detection)

Bu proje, ESP32 (LilyGO TTGO T-Beam) kullanılarak geliştirilmiş bir alev (yangın) algılama sistemidir. Ortamda alev tespit edildiğinde hem sesli (buzzer) hem de görsel (OLED ekran) olarak uyarı verir.

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

## 📂 Proje Yapısı

- `main/main.c`: I2C, AXP192 başlatma, OLED ekran bitmap grafikleri (framebuffer) ve ana kontrol döngüsünü barındıran temel kod dosyası.
- `bağlantıl-şemasi.md`: Alternatif ve detaylı bağlantı notları.
- `.gitignore`: ESP-IDF derleme dosyalarının ve IDE ayarlarının git'e atılmasını engelleyen kurallar.

## 📝 Lisans

Bu proje açık kaynaklıdır ve dilediğiniz gibi geliştirmeye açıktır.
