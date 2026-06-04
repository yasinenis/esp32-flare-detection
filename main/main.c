#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "driver/i2c.h"
#include "esp_log.h"

static const char *TAG = "FLAME_DETECTOR";

// Pin Tanımlamaları
#define FLAME_SENSOR_GPIO 13
#define BUZZER_GPIO       25
#define I2C_MASTER_SDA_IO 21
#define I2C_MASTER_SCL_IO 22
#define I2C_MASTER_NUM    I2C_NUM_0
#define I2C_MASTER_FREQ_HZ 400000

// AXP192 (PMU) Adres ve Yazmaçlar
#define AXP192_ADDR          0x34
#define AXP192_LDO23_DC1_CTRL 0x12

// SSD1306 (OLED) Adres
#define OLED_ADDR            0x3C

// ========================================================================
// 5x7 Font Tablosu (ASCII 32-90: boşluk, noktalama, rakamlar, harfler)
// ========================================================================
static const uint8_t font5x7[][5] = {
    {0x00,0x00,0x00,0x00,0x00}, // 32: ' '
    {0x00,0x00,0x5F,0x00,0x00}, // 33: '!'
    {0x00,0x07,0x00,0x07,0x00}, // 34: '"'
    {0x14,0x7F,0x14,0x7F,0x14}, // 35: '#'
    {0x24,0x2A,0x7F,0x2A,0x12}, // 36: '$'
    {0x23,0x13,0x08,0x64,0x62}, // 37: '%'
    {0x36,0x49,0x55,0x22,0x50}, // 38: '&'
    {0x00,0x05,0x03,0x00,0x00}, // 39: '''
    {0x00,0x1C,0x22,0x41,0x00}, // 40: '('
    {0x00,0x41,0x22,0x1C,0x00}, // 41: ')'
    {0x08,0x2A,0x1C,0x2A,0x08}, // 42: '*'
    {0x08,0x08,0x3E,0x08,0x08}, // 43: '+'
    {0x00,0x50,0x30,0x00,0x00}, // 44: ','
    {0x08,0x08,0x08,0x08,0x08}, // 45: '-'
    {0x00,0x60,0x60,0x00,0x00}, // 46: '.'
    {0x20,0x10,0x08,0x04,0x02}, // 47: '/'
    {0x3E,0x51,0x49,0x45,0x3E}, // 48: '0'
    {0x00,0x42,0x7F,0x40,0x00}, // 49: '1'
    {0x42,0x61,0x51,0x49,0x46}, // 50: '2'
    {0x21,0x41,0x45,0x4B,0x31}, // 51: '3'
    {0x18,0x14,0x12,0x7F,0x10}, // 52: '4'
    {0x27,0x45,0x45,0x45,0x39}, // 53: '5'
    {0x3C,0x4A,0x49,0x49,0x30}, // 54: '6'
    {0x01,0x71,0x09,0x05,0x03}, // 55: '7'
    {0x36,0x49,0x49,0x49,0x36}, // 56: '8'
    {0x06,0x49,0x49,0x29,0x1E}, // 57: '9'
    {0x00,0x36,0x36,0x00,0x00}, // 58: ':'
    {0x00,0x56,0x36,0x00,0x00}, // 59: ';'
    {0x00,0x08,0x14,0x22,0x41}, // 60: '<'
    {0x14,0x14,0x14,0x14,0x14}, // 61: '='
    {0x41,0x22,0x14,0x08,0x00}, // 62: '>'
    {0x02,0x01,0x51,0x09,0x06}, // 63: '?'
    {0x32,0x49,0x79,0x41,0x3E}, // 64: '@'
    {0x7E,0x11,0x11,0x11,0x7E}, // 65: 'A'
    {0x7F,0x49,0x49,0x49,0x36}, // 66: 'B'
    {0x3E,0x41,0x41,0x41,0x22}, // 67: 'C'
    {0x7F,0x41,0x41,0x22,0x1C}, // 68: 'D'
    {0x7F,0x49,0x49,0x49,0x41}, // 69: 'E'
    {0x7F,0x09,0x09,0x01,0x01}, // 70: 'F'
    {0x3E,0x41,0x41,0x51,0x32}, // 71: 'G'
    {0x7F,0x08,0x08,0x08,0x7F}, // 72: 'H'
    {0x00,0x41,0x7F,0x41,0x00}, // 73: 'I'
    {0x20,0x40,0x41,0x3F,0x01}, // 74: 'J'
    {0x7F,0x08,0x14,0x22,0x41}, // 75: 'K'
    {0x7F,0x40,0x40,0x40,0x40}, // 76: 'L'
    {0x7F,0x02,0x04,0x02,0x7F}, // 77: 'M'
    {0x7F,0x04,0x08,0x10,0x7F}, // 78: 'N'
    {0x3E,0x41,0x41,0x41,0x3E}, // 79: 'O'
    {0x7F,0x09,0x09,0x09,0x06}, // 80: 'P'
    {0x3E,0x41,0x51,0x21,0x5E}, // 81: 'Q'
    {0x7F,0x09,0x19,0x29,0x46}, // 82: 'R'
    {0x46,0x49,0x49,0x49,0x31}, // 83: 'S'
    {0x01,0x01,0x7F,0x01,0x01}, // 84: 'T'
    {0x3F,0x40,0x40,0x40,0x3F}, // 85: 'U'
    {0x1F,0x20,0x40,0x20,0x1F}, // 86: 'V'
    {0x3F,0x40,0x38,0x40,0x3F}, // 87: 'W'
    {0x63,0x14,0x08,0x14,0x63}, // 88: 'X'
    {0x07,0x08,0x70,0x08,0x07}, // 89: 'Y'
    {0x61,0x51,0x49,0x45,0x43}, // 90: 'Z'
};

// ========================================================================
// I2C & AXP192 Fonksiyonları
// ========================================================================

esp_err_t i2c_master_init(void) {
    i2c_config_t conf = {
        .mode = I2C_MODE_MASTER,
        .sda_io_num = I2C_MASTER_SDA_IO,
        .sda_pullup_en = GPIO_PULLUP_ENABLE,
        .scl_io_num = I2C_MASTER_SCL_IO,
        .scl_pullup_en = GPIO_PULLUP_ENABLE,
        .master.clk_speed = I2C_MASTER_FREQ_HZ,
    };
    i2c_param_config(I2C_MASTER_NUM, &conf);
    return i2c_driver_install(I2C_MASTER_NUM, conf.mode, 0, 0, 0);
}

void axp192_init(void) {
    uint8_t data;
    i2c_cmd_handle_t cmd = i2c_cmd_link_create();
    
    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, (AXP192_ADDR << 1) | I2C_MASTER_WRITE, true);
    i2c_master_write_byte(cmd, AXP192_LDO23_DC1_CTRL, true);
    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, (AXP192_ADDR << 1) | I2C_MASTER_READ, true);
    i2c_master_read_byte(cmd, &data, I2C_MASTER_NACK);
    i2c_master_stop(cmd);
    i2c_master_cmd_begin(I2C_MASTER_NUM, cmd, 1000 / portTICK_PERIOD_MS);
    i2c_cmd_link_delete(cmd);

    data |= (0x01 | 0x04 | 0x08); 

    cmd = i2c_cmd_link_create();
    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, (AXP192_ADDR << 1) | I2C_MASTER_WRITE, true);
    i2c_master_write_byte(cmd, AXP192_LDO23_DC1_CTRL, true);
    i2c_master_write_byte(cmd, data, true);
    i2c_master_stop(cmd);
    i2c_master_cmd_begin(I2C_MASTER_NUM, cmd, 1000 / portTICK_PERIOD_MS);
    i2c_cmd_link_delete(cmd);
    ESP_LOGI(TAG, "AXP192: OLED ve 3.3V Raylari (LDO2/3) acildi.");
}

// ========================================================================
// SSD1306 OLED Temel Fonksiyonlar
// ========================================================================

void oled_send_cmd(uint8_t command) {
    i2c_cmd_handle_t cmd = i2c_cmd_link_create();
    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, (OLED_ADDR << 1) | I2C_MASTER_WRITE, true);
    i2c_master_write_byte(cmd, 0x00, true);
    i2c_master_write_byte(cmd, command, true);
    i2c_master_stop(cmd);
    i2c_master_cmd_begin(I2C_MASTER_NUM, cmd, 10 / portTICK_PERIOD_MS);
    i2c_cmd_link_delete(cmd);
}

void oled_clear(void) {
    for (uint8_t i = 0; i < 8; i++) {
        oled_send_cmd(0xB0 + i);
        oled_send_cmd(0x00);
        oled_send_cmd(0x10);
        i2c_cmd_handle_t cmd = i2c_cmd_link_create();
        i2c_master_start(cmd);
        i2c_master_write_byte(cmd, (OLED_ADDR << 1) | I2C_MASTER_WRITE, true);
        i2c_master_write_byte(cmd, 0x40, true);
        for (uint8_t j = 0; j < 128; j++) {
            i2c_master_write_byte(cmd, 0x00, true);
        }
        i2c_master_stop(cmd);
        i2c_master_cmd_begin(I2C_MASTER_NUM, cmd, 10 / portTICK_PERIOD_MS);
        i2c_cmd_link_delete(cmd);
    }
}

void oled_init(void) {
    oled_send_cmd(0xAE);
    oled_send_cmd(0xD5); oled_send_cmd(0x80);
    oled_send_cmd(0xA8); oled_send_cmd(0x3F);
    oled_send_cmd(0xD3); oled_send_cmd(0x00);
    oled_send_cmd(0x40);
    oled_send_cmd(0x8D); oled_send_cmd(0x14);
    oled_send_cmd(0x20); oled_send_cmd(0x02);
    oled_send_cmd(0xA1);
    oled_send_cmd(0xC8);
    oled_send_cmd(0xDA); oled_send_cmd(0x12);
    oled_send_cmd(0x81); oled_send_cmd(0xFF);
    oled_send_cmd(0xD9); oled_send_cmd(0xF1);
    oled_send_cmd(0xDB); oled_send_cmd(0x40);
    oled_send_cmd(0xA4);
    oled_send_cmd(0xA6);
    oled_clear();
    oled_send_cmd(0xAF);
    ESP_LOGI(TAG, "OLED Baslatildi.");
}

void oled_set_cursor(uint8_t page, uint8_t col) {
    oled_send_cmd(0xB0 + page);
    oled_send_cmd(col & 0x0F);
    oled_send_cmd(0x10 | (col >> 4));
}

// ========================================================================
// Framebuffer Tabanlı Çizim Fonksiyonları
// ========================================================================

// Her biri 128x64 piksel = 1024 byte
static uint8_t fb_flame[1024];
static uint8_t fb_safe[1024];

/**
 * @brief Framebuffer'da bir piksel aç
 */
static void fb_set_pixel(uint8_t *fb, int x, int y) {
    if (x >= 0 && x < 128 && y >= 0 && y < 64)
        fb[(y / 8) * 128 + x] |= (1 << (y % 8));
}

/**
 * @brief Framebuffer'da yatay çizgi çiz
 */
static void fb_hline(uint8_t *fb, int x0, int x1, int y) {
    for (int x = x0; x <= x1; x++)
        fb_set_pixel(fb, x, y);
}

/**
 * @brief Framebuffer'a 2x boyutlu karakter çiz (10x14 piksel)
 */
static void fb_draw_char_2x(uint8_t *fb, int px, int py, char c) {
    if (c < 32 || c > 90) c = ' ';
    int idx = c - 32;
    for (int col = 0; col < 5; col++) {
        uint8_t bits = font5x7[idx][col];
        for (int row = 0; row < 7; row++) {
            if (bits & (1 << row)) {
                fb_set_pixel(fb, px + col*2,     py + row*2);
                fb_set_pixel(fb, px + col*2 + 1, py + row*2);
                fb_set_pixel(fb, px + col*2,     py + row*2 + 1);
                fb_set_pixel(fb, px + col*2 + 1, py + row*2 + 1);
            }
        }
    }
}

/**
 * @brief Framebuffer'a 2x boyutlu string çiz
 */
static void fb_draw_string_2x(uint8_t *fb, int px, int py, const char *str) {
    while (*str) {
        char c = *str;
        if (c >= 'a' && c <= 'z') c -= 32;
        fb_draw_char_2x(fb, px, py, c);
        px += 12; // 10px karakter + 2px boşluk
        str++;
    }
}

/**
 * @brief 1024-byte framebuffer'ı OLED'e aktar (tam ekran güncelleme)
 */
static void oled_draw_bitmap(const uint8_t *fb) {
    for (uint8_t page = 0; page < 8; page++) {
        oled_set_cursor(page, 0);
        i2c_cmd_handle_t cmd = i2c_cmd_link_create();
        i2c_master_start(cmd);
        i2c_master_write_byte(cmd, (OLED_ADDR << 1) | I2C_MASTER_WRITE, true);
        i2c_master_write_byte(cmd, 0x40, true); // Veri modu
        for (int col = 0; col < 128; col++) {
            i2c_master_write_byte(cmd, fb[page * 128 + col], true);
        }
        i2c_master_stop(cmd);
        i2c_master_cmd_begin(I2C_MASTER_NUM, cmd, 100 / portTICK_PERIOD_MS);
        i2c_cmd_link_delete(cmd);
    }
}

// ========================================================================
// Bitmap Oluşturma: Alev İkonu (Tam Ekran)
// ========================================================================

static void generate_flame_bitmap(void) {
    memset(fb_flame, 0, sizeof(fb_flame));

    int cx = 64; // Merkez sütun

    // Ana alev gövdesi: y=0 (uç) -> y=47 (taban)
    // Her satır için merkeze olan yarı-genişlik (half-width)
    static const uint8_t flame_hw[] = {
         1,  2,  4,  6,  8, 10, 13, 15, 18, 20,  // y=0-9:   uç
        22, 24, 26, 28, 29, 30, 31, 32, 33, 34,  // y=10-19: genişleme
        35, 36, 36, 37, 37, 38, 38, 38, 38, 38,  // y=20-29: en geniş
        37, 37, 36, 35, 34, 33, 31, 29, 27, 25,  // y=30-39: daralma
        22, 19, 16, 13, 10,  7,  4,  2            // y=40-47: taban
    };

    int flame_rows = sizeof(flame_hw) / sizeof(flame_hw[0]);
    for (int i = 0; i < flame_rows; i++) {
        fb_hline(fb_flame, cx - flame_hw[i], cx + flame_hw[i], i);
    }

    // Sol alev dili (doğal görünüm için asimetrik çıkıntı)
    // Merkez: x=42, y=0-16
    static const uint8_t tongue_l_hw[] = {
        1, 2, 3, 4, 6, 7, 8, 9, 9, 9, 8, 7, 6, 5, 3, 2, 1
    };
    int tcx_l = 42;
    for (int i = 0; i < 17; i++) {
        fb_hline(fb_flame, tcx_l - tongue_l_hw[i], tcx_l + tongue_l_hw[i], i);
    }

    // Sağ küçük alev dili
    // Merkez: x=80, y=2-12
    static const uint8_t tongue_r_hw[] = {
        1, 1, 2, 3, 4, 4, 4, 3, 3, 2, 1
    };
    int tcx_r = 80;
    for (int i = 0; i < 11; i++) {
        fb_hline(fb_flame, tcx_r - tongue_r_hw[i], tcx_r + tongue_r_hw[i], i + 2);
    }

    // İç alev boşluğu (klasik alev ikonundaki iç dil efekti)
    // Merkez: x=64, y=22-40 arası boşluk bırakarak iç dil oluştur
    static const uint8_t inner_cut_hw[] = {
        1, 2, 3, 4, 5, 6, 7, 8, 8, 9,
        9, 9, 8, 8, 7, 6, 5, 3, 1
    };
    for (int i = 0; i < 19; i++) {
        int y = i + 22;
        int hw = inner_cut_hw[i];
        for (int x = cx - hw; x <= cx + hw; x++) {
            // Pikseli kapat (iç boşluk)
            if (x >= 0 && x < 128 && y >= 0 && y < 64)
                fb_flame[(y / 8) * 128 + x] &= ~(1 << (y % 8));
        }
    }

    // İç dil: boşluğun içine küçük bir alev şekli çiz
    static const uint8_t inner_flame_hw[] = {
        1, 1, 2, 2, 3, 3, 4, 4, 4, 4,
        4, 3, 3, 2, 1
    };
    for (int i = 0; i < 15; i++) {
        int y = i + 24;
        fb_hline(fb_flame, cx - inner_flame_hw[i], cx + inner_flame_hw[i], y);
    }

    // Alt kısım: "! ALEV !" yazısı (2x büyüklük)
    // 8 karakter * 12px = 96px, merkez: (128-96)/2 = 16
    fb_draw_string_2x(fb_flame, 16, 50, "! FIRE !");
}

// ========================================================================
// Bitmap Oluşturma: Güvenli İkonu (Kalkan + Tik İşareti)
// ========================================================================

static void generate_safe_bitmap(void) {
    memset(fb_safe, 0, sizeof(fb_safe));

    int cx = 64; // Merkez sütun
    int shield_top = 2;
    int shield_flat_end = 11;  // Düz üst kısmın bitişi
    int shield_bottom = 44;    // Kalkanın alt ucu
    int shield_max_hw = 30;    // Maksimum yarı-genişlik

    // 1. Kalkan dış şeklini doldur
    for (int y = shield_top; y <= shield_bottom; y++) {
        int hw;
        if (y <= shield_flat_end) {
            hw = shield_max_hw; // Düz üst kısım
        } else {
            // Doğrusal daralma (alt uca doğru)
            hw = shield_max_hw * (shield_bottom - y) / (shield_bottom - shield_flat_end);
        }
        if (hw < 0) hw = 0;
        fb_hline(fb_safe, cx - hw, cx + hw, y);
    }

    // 2. İç kısmı temizle (3px kenarlık bırakarak)
    for (int y = shield_top + 3; y <= shield_bottom; y++) {
        int hw_outer;
        if (y <= shield_flat_end) {
            hw_outer = shield_max_hw;
        } else {
            hw_outer = shield_max_hw * (shield_bottom - y) / (shield_bottom - shield_flat_end);
        }
        int hw_inner = hw_outer - 3;
        if (hw_inner > 0) {
            for (int x = cx - hw_inner; x <= cx + hw_inner; x++) {
                if (x >= 0 && x < 128 && y >= 0 && y < 64)
                    fb_safe[(y / 8) * 128 + x] &= ~(1 << (y % 8));
            }
        }
    }

    // 3. Tik işareti (checkmark) çiz - kalkanın içine
    // İnen kısım: (50, 22) -> (60, 32) - sağ aşağı çapraz
    for (int i = 0; i <= 10; i++) {
        int x = 50 + i;
        int y = 22 + i;
        // 3x3 piksel kalınlık
        for (int dy = -1; dy <= 1; dy++) {
            for (int dx = -1; dx <= 1; dx++) {
                fb_set_pixel(fb_safe, x + dx, y + dy);
            }
        }
    }

    // Çıkan kısım: (60, 32) -> (80, 12) - sağ yukarı çapraz
    for (int i = 0; i <= 20; i++) {
        int x = 60 + i;
        int y = 32 - (i * 20) / 20; // 32'den 12'ye
        // 3x3 piksel kalınlık
        for (int dy = -1; dy <= 1; dy++) {
            for (int dx = -1; dx <= 1; dx++) {
                fb_set_pixel(fb_safe, x + dx, y + dy);
            }
        }
    }

    // Alt kısım: "GUVENLI" yazısı (2x büyüklük)
    // 7 karakter * 12px = 84px, merkez: (128-84)/2 = 22
    fb_draw_string_2x(fb_safe, 22, 50, "SAFE :)");
}

// ========================================================================
// Ana Uygulama
// ========================================================================

void app_main(void) {
    // 1. I2C Başlat
    ESP_ERROR_CHECK(i2c_master_init());

    // 2. AXP192 Güç Ayarı
    axp192_init();

    // 3. OLED Başlat
    oled_init();

    // 4. GPIO - Alev Sensörü (Giriş)
    gpio_config_t io_conf = {
        .intr_type = GPIO_INTR_DISABLE,
        .mode = GPIO_MODE_INPUT,
        .pin_bit_mask = (1ULL << FLAME_SENSOR_GPIO),
        .pull_down_en = 0,
        .pull_up_en = 1,
    };
    gpio_config(&io_conf);

    // 5. GPIO - Buzzer (Çıkış, Active-High)
    //    VCC pini GPIO 25'e bağlı, HIGH = güç verir = öter
    gpio_set_level(BUZZER_GPIO, 0); // Önce sessiz

    gpio_config_t bz_conf = {
        .intr_type = GPIO_INTR_DISABLE,
        .mode = GPIO_MODE_OUTPUT,
        .pin_bit_mask = (1ULL << BUZZER_GPIO),
        .pull_up_en = 0,
        .pull_down_en = 1,
    };
    gpio_config(&bz_conf);
    gpio_set_level(BUZZER_GPIO, 0); // Başlangıçta sessiz

    // 6. Bitmap'leri oluştur (bir kez, başlangıçta)
    generate_flame_bitmap();
    generate_safe_bitmap();

    // 7. Başlangıç ekranı: güvenli
    oled_draw_bitmap(fb_safe);

    ESP_LOGI(TAG, "Sistem Hazir. Izleme basliyor...");

    int last_flame_val = -1;

    while (1) {
        int flame_val = gpio_get_level(FLAME_SENSOR_GPIO);

        // Sadece durum değiştiğinde ekranı güncelle
        if (flame_val != last_flame_val) {
            if (flame_val == 0) {
                // ALEV TESPİT EDİLDİ
                ESP_LOGW(TAG, ">>> ALEV TESPIT EDILDI! <<<");
                gpio_set_level(BUZZER_GPIO, 1); // Buzzer AÇIK
                oled_draw_bitmap(fb_flame);      // Alev ikonu göster
            } else {
                // GÜVENLİ
                ESP_LOGI(TAG, "Durum: Normal (Alev yok)");
                gpio_set_level(BUZZER_GPIO, 0); // Buzzer KAPALI
                oled_draw_bitmap(fb_safe);       // Güvenli ikonu göster
            }
            last_flame_val = flame_val;
        }

        vTaskDelay(500 / portTICK_PERIOD_MS);
    }
}
