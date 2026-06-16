#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "driver/i2c.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_system.h"
#include "esp_mac.h"
// --- Ağ / sunucu bileşenleri (web dashboard entegrasyonu) ---
#include "nvs_flash.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "esp_sntp.h"
#include "esp_http_server.h"
#include "cJSON.h"

static const char *TAG = "FLAME_DETECTOR";

// ========================================================================
//  >>> WEB DASHBOARD AYARLARI <<<
// ========================================================================
//  WiFi bilgileri GİZLİ tutulur ve GitHub'a GÖNDERİLMEZ:
//    -> main/secrets.h  (.gitignore tarafından yok sayılır)
//  Kurulum: main/secrets.example.h dosyasını main/secrets.h olarak kopyalayın
//           ve WiFi adı/şifrenizi girin.
// ------------------------------------------------------------------------
#if defined(__has_include)
#  if __has_include("secrets.h")
#    include "secrets.h"   // WIFI_SSID ve WIFI_PASS buradan gelir
#  endif
#endif
#ifndef WIFI_SSID
#  error "main/secrets.h bulunamadi! 'main/secrets.example.h' -> 'main/secrets.h' olarak kopyalayip WiFi bilgilerinizi girin."
#endif

#define DEVICE_ID      "tbeam-01"         // panel CONFIG.devices[].id ile AYNI olmalı
#define FIRMWARE_VER   "1.0.0"
#define STATUS_PERIOD_US (2 * 1000000)    // durum yayını periyodu (2 sn)
#define MAX_ALARM_HIST  50                // RAM'de tutulacak alarm geçmişi adedi
// ========================================================================

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
#define AXP192_ADC_EN1        0x82   // ADC açma register'ı (pil voltajı/akımı vb.)
#define AXP192_POWER_STATUS   0x00   // VBUS/şarj yönü
#define AXP192_CHARGE_STATUS  0x01   // şarj göstergesi / pil var mı
#define AXP192_BAT_VOLT_H     0x78   // pil voltajı ADC (12-bit, 1.1mV/LSB)
#define AXP192_BAT_CHG_CUR_H  0x7A   // şarj akımı (13-bit, 0.5mA/LSB)
#define AXP192_BAT_DIS_CUR_H  0x7C   // deşarj akımı (13-bit, 0.5mA/LSB)

// SSD1306 (OLED) Adres
#define OLED_ADDR            0x3C

// ------------------------------------------------------------------------
//  Paylaşılan durum (task'lar arası)
// ------------------------------------------------------------------------
static httpd_handle_t g_server = NULL;
static volatile bool  g_wifi_connected = false;
static volatile bool  g_muted = false;          // buzzer susturuldu mu (mute komutu)
static volatile int64_t g_test_until_us = 0;     // test alarmının biteceği zaman

// Bellekte küçük alarm geçmişi (panelin GET /api/alarms isteği için)
typedef struct { int id; long start; long end; int durationSec; } alarm_rec_t;
static alarm_rec_t g_alarms[MAX_ALARM_HIST];
static int g_alarm_count = 0;
static int g_alarm_next_id = 1;

// İleri bildirimler
static void axp_read_power(bool *usb, bool *charging, int *pct, float *volt, int *curMa);

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

    // --- ADC'leri aç: pil voltajı/akımı, VBUS vb. (güç verisi okumak için) ---
    cmd = i2c_cmd_link_create();
    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, (AXP192_ADDR << 1) | I2C_MASTER_WRITE, true);
    i2c_master_write_byte(cmd, AXP192_ADC_EN1, true);
    i2c_master_write_byte(cmd, 0xFF, true); // tüm ADC kanallarını etkinleştir
    i2c_master_stop(cmd);
    i2c_master_cmd_begin(I2C_MASTER_NUM, cmd, 1000 / portTICK_PERIOD_MS);
    i2c_cmd_link_delete(cmd);

    ESP_LOGI(TAG, "AXP192: OLED/3.3V raylari acildi, ADC'ler etkin.");
}

// ========================================================================
//  AXP192 Güç Verisi Okuma (pil/şarj/USB/akım)
// ========================================================================

/** Tek bir AXP192 register'ını okur. */
static uint8_t axp_read8(uint8_t reg) {
    uint8_t val = 0;
    i2c_cmd_handle_t cmd = i2c_cmd_link_create();
    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, (AXP192_ADDR << 1) | I2C_MASTER_WRITE, true);
    i2c_master_write_byte(cmd, reg, true);
    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, (AXP192_ADDR << 1) | I2C_MASTER_READ, true);
    i2c_master_read_byte(cmd, &val, I2C_MASTER_NACK);
    i2c_master_stop(cmd);
    i2c_master_cmd_begin(I2C_MASTER_NUM, cmd, 100 / portTICK_PERIOD_MS);
    i2c_cmd_link_delete(cmd);
    return val;
}

/** 12-bit ADC (yüksek 8 bit + düşük 4 bit). */
static uint16_t axp_read12(uint8_t regH) {
    uint8_t h = axp_read8(regH);
    uint8_t l = axp_read8(regH + 1);
    return ((uint16_t)h << 4) | (l & 0x0F);
}

/** 13-bit ADC (yüksek 8 bit + düşük 5 bit) — akım okumaları için. */
static uint16_t axp_read13(uint8_t regH) {
    uint8_t h = axp_read8(regH);
    uint8_t l = axp_read8(regH + 1);
    return ((uint16_t)h << 5) | (l & 0x1F);
}

/** Pil voltajından kabaca yüzde tahmini (LiPo, 3.3V=%0 .. 4.2V=%100). */
static int batt_pct_from_voltage(float v) {
    if (v <= 3.30f) return 0;
    if (v >= 4.20f) return 100;
    return (int)((v - 3.30f) / (4.20f - 3.30f) * 100.0f + 0.5f);
}

/**
 * AXP192'den güç durumunu okur.
 * NOT: Pil takılı değilse voltaj ~0 ve yüzde 0 görünür (bu normaldir).
 *      Bit konumları kart/PMU revizyonuna göre nadiren değişebilir.
 */
static void axp_read_power(bool *usb, bool *charging, int *pct, float *volt, int *curMa) {
    uint8_t powerStatus  = axp_read8(AXP192_POWER_STATUS);  // 0x00
    uint8_t chargeStatus = axp_read8(AXP192_CHARGE_STATUS); // 0x01

    bool usbPresent  = (powerStatus  & 0x20) != 0; // VBUS mevcut
    bool batPresent  = (chargeStatus & 0x20) != 0; // pil takılı
    bool isCharging  = (chargeStatus & 0x40) != 0; // şarj göstergesi

    float vBat = axp_read12(AXP192_BAT_VOLT_H) * 1.1f / 1000.0f; // Volt
    int chgCur = (int)(axp_read13(AXP192_BAT_CHG_CUR_H) * 0.5f); // mA
    int disCur = (int)(axp_read13(AXP192_BAT_DIS_CUR_H) * 0.5f); // mA

    *usb      = usbPresent;
    *charging = batPresent && isCharging;
    *volt     = batPresent ? vBat : 0.0f;
    *pct      = batPresent ? batt_pct_from_voltage(vBat) : 0;
    *curMa    = batPresent ? (chgCur - disCur) : 0; // + şarj, - deşarj
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
//  JSON Üretimi (durum + alarm geçmişi) — panel şemasıyla birebir
// ========================================================================

/** Şemaya uygun anlık durum JSON'u üretir. Dönen string'i çağıran free etmeli. */
static char *build_status_json(bool detected, bool buzzer) {
    bool usb, charging; int pct, curMa; float volt;
    axp_read_power(&usb, &charging, &pct, &volt, &curMa);

    int rssi = 0;
    wifi_ap_record_t ap;
    if (esp_wifi_sta_get_ap_info(&ap) == ESP_OK) rssi = ap.rssi;

    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "deviceId", DEVICE_ID);
    cJSON_AddBoolToObject(root, "online", true);
    cJSON_AddNumberToObject(root, "timestamp", (double)time(NULL));
    cJSON_AddNumberToObject(root, "uptimeSec", (double)(esp_timer_get_time() / 1000000));
    cJSON_AddStringToObject(root, "firmware", FIRMWARE_VER);

    cJSON *flame = cJSON_AddObjectToObject(root, "flame");
    cJSON_AddBoolToObject(flame, "detected", detected);
    cJSON_AddBoolToObject(flame, "sensorActive", true); // dijital sensör; arıza tespiti yoksa true

    cJSON_AddBoolToObject(root, "buzzer", buzzer);

    cJSON *power = cJSON_AddObjectToObject(root, "power");
    cJSON_AddBoolToObject(power, "usbConnected", usb);
    cJSON_AddBoolToObject(power, "charging", charging);
    cJSON_AddNumberToObject(power, "batteryPercent", pct);
    cJSON_AddNumberToObject(power, "batteryVoltage", volt);
    cJSON_AddNumberToObject(power, "currentMa", curMa);

    cJSON *wifi = cJSON_AddObjectToObject(root, "wifi");
    cJSON_AddNumberToObject(wifi, "rssi", rssi);

    cJSON *sys = cJSON_AddObjectToObject(root, "system");
    cJSON_AddNumberToObject(sys, "freeHeap", (double)esp_get_free_heap_size());

    char *out = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return out;
}

/** Bellekteki alarm geçmişini JSON dizisi olarak üretir (GET /api/alarms). */
static char *build_alarms_json(void) {
    cJSON *arr = cJSON_CreateArray();
    for (int i = 0; i < g_alarm_count; i++) {
        cJSON *a = cJSON_CreateObject();
        cJSON_AddNumberToObject(a, "id", g_alarms[i].id);
        cJSON_AddNumberToObject(a, "start", (double)g_alarms[i].start);
        cJSON_AddNumberToObject(a, "end", (double)g_alarms[i].end);
        cJSON_AddNumberToObject(a, "durationSec", g_alarms[i].durationSec);
        cJSON_AddItemToArray(arr, a);
    }
    char *out = cJSON_PrintUnformatted(arr);
    cJSON_Delete(arr);
    return out;
}

/** Biten bir alarm olayını geçmişe ekler (gerekirse en eskisini düşürür). */
static void history_push(long start, long end, int durationSec) {
    alarm_rec_t rec = { g_alarm_next_id++, start, end, durationSec };
    if (g_alarm_count < MAX_ALARM_HIST) {
        g_alarms[g_alarm_count++] = rec;
    } else {
        memmove(&g_alarms[0], &g_alarms[1], sizeof(alarm_rec_t) * (MAX_ALARM_HIST - 1));
        g_alarms[MAX_ALARM_HIST - 1] = rec;
    }
}

// ========================================================================
//  WebSocket yayını + Komut işleme
// ========================================================================

/** Bağlı tüm WebSocket istemcilerine metin (JSON) gönderir. */
static void ws_broadcast(const char *json) {
    if (!g_server || !json) return;
    size_t fds = CONFIG_LWIP_MAX_SOCKETS;
    int client_fds[CONFIG_LWIP_MAX_SOCKETS];
    if (httpd_get_client_list(g_server, &fds, client_fds) != ESP_OK) return;

    for (size_t i = 0; i < fds; i++) {
        if (httpd_ws_get_fd_info(g_server, client_fds[i]) == HTTPD_WS_CLIENT_WEBSOCKET) {
            httpd_ws_frame_t frame = {0};
            frame.type = HTTPD_WS_TYPE_TEXT;
            frame.payload = (uint8_t *)json;
            frame.len = strlen(json);
            httpd_ws_send_frame_async(g_server, client_fds[i], &frame);
        }
    }
}

/** Panelden gelen komutu işler: "mute" | "test" | "restart" (JSON veya düz metin). */
static void handle_command(const char *msg) {
    if (!msg) return;
    const char *cmd = msg;
    cJSON *root = cJSON_Parse(msg);
    if (root) {
        cJSON *c = cJSON_GetObjectItem(root, "command");
        if (cJSON_IsString(c) && c->valuestring) cmd = c->valuestring;
    }
    bool isRestart = strstr(cmd, "restart") != NULL;
    bool isMute    = strstr(cmd, "mute")    != NULL;
    bool isTest    = strstr(cmd, "test")    != NULL;
    if (root) cJSON_Delete(root); // cmd bundan sonra geçersiz — booleanları önce hesapladık

    if (isRestart) {
        ESP_LOGW(TAG, "Komut: cihaz yeniden baslatiliyor");
        vTaskDelay(200 / portTICK_PERIOD_MS);
        esp_restart();
    } else if (isMute) {
        ESP_LOGI(TAG, "Komut: buzzer susturuldu (mute)");
        g_muted = true;
        gpio_set_level(BUZZER_GPIO, 0);
    } else if (isTest) {
        ESP_LOGI(TAG, "Komut: test alarmi (6 sn)");
        g_test_until_us = esp_timer_get_time() + 6 * 1000000;
    }
}

// ========================================================================
//  HTTP / WebSocket Sunucu
// ========================================================================

/** Panel farklı bir kaynaktan (origin) servis edildiği için CORS başlıkları. */
static void set_cors(httpd_req_t *req) {
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Headers", "Content-Type");
}

/** /ws — WebSocket: handshake (GET) + gelen komut çerçeveleri. */
static esp_err_t ws_handler(httpd_req_t *req) {
    if (req->method == HTTP_GET) {
        ESP_LOGI(TAG, "WebSocket istemci baglandi.");
        return ESP_OK; // handshake tamam
    }
    httpd_ws_frame_t ws_pkt = {0};
    ws_pkt.type = HTTPD_WS_TYPE_TEXT;
    // Önce uzunluğu öğren
    esp_err_t ret = httpd_ws_recv_frame(req, &ws_pkt, 0);
    if (ret != ESP_OK) return ret;
    if (ws_pkt.len) {
        uint8_t *buf = calloc(1, ws_pkt.len + 1);
        if (!buf) return ESP_ERR_NO_MEM;
        ws_pkt.payload = buf;
        ret = httpd_ws_recv_frame(req, &ws_pkt, ws_pkt.len);
        if (ret == ESP_OK) handle_command((char *)buf);
        free(buf);
    }
    return ESP_OK;
}

/** GET /api/status — anlık durum (HTTP fallback / polling). */
static esp_err_t status_get_handler(httpd_req_t *req) {
    set_cors(req);
    int raw = gpio_get_level(FLAME_SENSOR_GPIO);
    bool detected = (raw == 0) || (esp_timer_get_time() < g_test_until_us);
    char *json = build_status_json(detected, detected && !g_muted);
    httpd_resp_set_type(req, "application/json");
    httpd_resp_sendstr(req, json ? json : "{}");
    free(json);
    return ESP_OK;
}

/** GET /api/alarms — alarm geçmişi (panel grafikleri/günlüğü). */
static esp_err_t alarms_get_handler(httpd_req_t *req) {
    set_cors(req);
    char *json = build_alarms_json();
    httpd_resp_set_type(req, "application/json");
    httpd_resp_sendstr(req, json ? json : "[]");
    free(json);
    return ESP_OK;
}

/** POST /api/command — uzaktan komut (HTTP fallback). */
static esp_err_t command_post_handler(httpd_req_t *req) {
    set_cors(req);
    char buf[256];
    int total = req->content_len;
    if (total > 0 && total < (int)sizeof(buf)) {
        int r = httpd_req_recv(req, buf, total);
        if (r > 0) { buf[r] = 0; handle_command(buf); }
    }
    httpd_resp_set_type(req, "application/json");
    httpd_resp_sendstr(req, "{\"ok\":true}");
    return ESP_OK;
}

/** OPTIONS /api/command — CORS preflight. */
static esp_err_t options_handler(httpd_req_t *req) {
    set_cors(req);
    httpd_resp_send(req, NULL, 0);
    return ESP_OK;
}

static void start_webserver(void) {
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.max_open_sockets = 4;
    config.lru_purge_enable = true;
    if (httpd_start(&g_server, &config) != ESP_OK) {
        ESP_LOGE(TAG, "HTTP/WS sunucu baslatilamadi!");
        return;
    }
    httpd_uri_t ws = { .uri = "/ws",          .method = HTTP_GET,     .handler = ws_handler, .is_websocket = true };
    httpd_uri_t st = { .uri = "/api/status",  .method = HTTP_GET,     .handler = status_get_handler };
    httpd_uri_t al = { .uri = "/api/alarms",  .method = HTTP_GET,     .handler = alarms_get_handler };
    httpd_uri_t cm = { .uri = "/api/command", .method = HTTP_POST,    .handler = command_post_handler };
    httpd_uri_t op = { .uri = "/api/command", .method = HTTP_OPTIONS, .handler = options_handler };
    httpd_register_uri_handler(g_server, &ws);
    httpd_register_uri_handler(g_server, &st);
    httpd_register_uri_handler(g_server, &al);
    httpd_register_uri_handler(g_server, &cm);
    httpd_register_uri_handler(g_server, &op);
    ESP_LOGI(TAG, "HTTP/WS sunucu basladi (port 80): /ws, /api/status, /api/alarms, /api/command");
}

// ========================================================================
//  WiFi (STA) + SNTP (gerçek epoch zaman damgası için)
// ========================================================================

static void on_wifi_event(void *arg, esp_event_base_t base, int32_t id, void *data) {
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        g_wifi_connected = false;
        ESP_LOGW(TAG, "WiFi koptu — yeniden baglaniliyor...");
        esp_wifi_connect();
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *e = (ip_event_got_ip_t *)data;
        ESP_LOGI(TAG, "WiFi baglandi. IP: " IPSTR "  (panel: ws://" IPSTR "/ws)",
                 IP2STR(&e->ip_info.ip), IP2STR(&e->ip_info.ip));
        g_wifi_connected = true;
        if (!g_server) start_webserver();
    }
}

static void sntp_start(void) {
    esp_sntp_setoperatingmode(ESP_SNTP_OPMODE_POLL);
    esp_sntp_setservername(0, "pool.ntp.org");
    esp_sntp_init();
    setenv("TZ", "UTC0", 1); // panel zamanı yerel saate kendi çevirir
    tzset();
}

static void wifi_init_sta(void) {
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &on_wifi_event, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &on_wifi_event, NULL));

    wifi_config_t wc = {0};
    strncpy((char *)wc.sta.ssid, WIFI_SSID, sizeof(wc.sta.ssid) - 1);
    strncpy((char *)wc.sta.password, WIFI_PASS, sizeof(wc.sta.password) - 1);
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wc));
    ESP_ERROR_CHECK(esp_wifi_start());
    sntp_start();
}

// ========================================================================
//  İzleme Görevi (alev algılama + buzzer + OLED + WebSocket yayını)
// ========================================================================

static void monitor_task(void *arg) {
    int last_detected = -1;
    long active_start = 0;
    int64_t last_bcast = 0;

    while (1) {
        int raw = gpio_get_level(FLAME_SENSOR_GPIO);
        bool detected = (raw == 0);                                  // GPIO13 LOW = alev
        if (esp_timer_get_time() < g_test_until_us) detected = true; // test alarmı override
        bool buzzer = detected && !g_muted;

        // Durum değişiminde: OLED, alarm geçmişi ve ANINDA yayın
        if ((int)detected != last_detected) {
            if (detected) {
                ESP_LOGW(TAG, ">>> ALEV TESPIT EDILDI! <<<");
                oled_draw_bitmap(fb_flame);
                active_start = time(NULL);
            } else {
                ESP_LOGI(TAG, "Durum: Normal (Alev yok)");
                oled_draw_bitmap(fb_safe);
                g_muted = false; // alev bitince mute sıfırlanır (sonraki alarm yine öter)
                if (active_start > 0) {
                    long now = time(NULL);
                    history_push(active_start, now, (int)(now - active_start));
                }
            }
            char *j = build_status_json(detected, buzzer);
            ws_broadcast(j);
            free(j);
            last_bcast = esp_timer_get_time();
            last_detected = detected;
        }

        gpio_set_level(BUZZER_GPIO, buzzer ? 1 : 0);

        // Periyodik yayın (2 sn) — alarm yokken de canlı kalır
        int64_t now_us = esp_timer_get_time();
        if (now_us - last_bcast >= STATUS_PERIOD_US) {
            char *j = build_status_json(detected, buzzer);
            ws_broadcast(j);
            free(j);
            last_bcast = now_us;
        }

        vTaskDelay(200 / portTICK_PERIOD_MS);
    }
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

    // 8. Ağ: NVS + WiFi (STA) + SNTP + WebSocket/HTTP sunucu
    //    (WiFi'ye bağlanınca sunucu on_wifi_event içinde otomatik başlar)
    esp_err_t nvs_ret = nvs_flash_init();
    if (nvs_ret == ESP_ERR_NVS_NO_FREE_PAGES || nvs_ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ESP_ERROR_CHECK(nvs_flash_init());
    }
    wifi_init_sta();

    ESP_LOGI(TAG, "Sistem Hazir. Izleme + WebSocket yayini basliyor...");

    // 9. İzleme görevini başlat (alev algılama + buzzer + OLED + WS yayını)
    //    cJSON + I2C kullandığı için yeterli stack veriyoruz.
    xTaskCreate(monitor_task, "monitor", 6144, NULL, 5, NULL);
}
