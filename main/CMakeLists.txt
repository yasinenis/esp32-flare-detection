idf_component_register(SRCS "main.c"
                    INCLUDE_DIRS "."
                    # Web dashboard entegrasyonu için gereken bileşenler:
                    REQUIRES driver esp_wifi esp_event esp_netif nvs_flash
                             esp_http_server json esp_timer lwip esp_hw_support)
