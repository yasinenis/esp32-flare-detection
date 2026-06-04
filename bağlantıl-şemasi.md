T-Beam Güncel Devre Bağlantı Listesi

1. Güç Dağıtımı (Breadboard Bağlantısı)
- T-Beam 3.3V Pini -> Breadboard Ortak Güç (+) Hattı
- T-Beam GND Pini -> Breadboard Ortak Toprak (-) Hattı

2. Alev Sensörü (Flame Sensor) Bağlantıları
- VCC -> Breadboard Ortak Güç (3.3V) Hattı
- GND -> Breadboard Ortak Toprak (GND) Hattı
- DO (Digital Output) -> T-Beam GPIO 13 (Dijital Sinyal Girişi - INPUT)
- AO (Analog Output) -> Kullanılmıyor, boş bırakıldı.

3. Buzzer Modülü Bağlantıları (HW-508 Aktif Buzzer)
- (+) VCC -&gt; T-Beam GPIO 25 (Buzzer Güç Kontrolü - OUTPUT)
- (-) GND -&gt; Breadboard Ortak Toprak (GND) Hattı
- I / SIG (Sinyal) -&gt; Bağlantısız (Kullanılmıyor)
- NOT: VCC pini doğrudan GPIO'ya bağlanır, 3.3V hattına DEĞİL.
  GPIO HIGH olduğunda buzzer'a güç gider ve öter,
  GPIO LOW olduğunda güç kesilir ve buzzer susar.

4. OLED Ekran Bağlantıları (I2C Protokolü)
- VCC -> Breadboard Ortak Güç (3.3V) Hattı
- GND -> Breadboard Ortak Toprak (GND) Hattı
- SDA -> T-Beam GPIO 21 (I2C Veri Hattı)
- SCL -> T-Beam GPIO 22 (I2C Saat/Clock Hattı)