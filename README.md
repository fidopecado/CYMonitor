# CYD Monitor

A touch-first ESP32 desk display for live PC telemetry, built around the **ESP32-3248S035 “CYD” 3.5″ board** and **LibreHardwareMonitor**.

The firmware polls a local LibreHardwareMonitor JSON endpoint over Wi-Fi, scans the hardware tree for CPU, GPU and RAM sensors, and renders the results on a 480 × 320 TFT with TFT_eSPI. The repository also includes a static browser recreation of the interface and a Docker image that serves the complete web experience.

![CYD Monitor landing page with the embedded simulator](docs/preview.png)

*Browser demo preview. The telemetry shown in the simulator is generated; the firmware reads real sensors when connected to LibreHardwareMonitor.*

> The browser demo is simulated. It does not connect to the ESP32 or to LibreHardwareMonitor.

## Contents

- [What it does](#what-it-does)
- [Screens](#screens)
- [Architecture](#architecture)
- [Hardware](#hardware)
- [Firmware notes](#firmware-notes)
- [Web demo](#web-demo)
- [Repository layout](#repository-layout)
- [Getting started](#getting-started)
- [Docker](#docker)
- [Configuration](#configuration)
- [Limitations](#limitations)
- [Acknowledgements](#acknowledgements)

## What it does

- **Monitor** — reads LibreHardwareMonitor’s JSON tree and scores CPU/GPU/RAM sensor candidates by hardware type, sensor type and label. Displays temperature, load, package power or fan RPM when available, GPU hotspot and VRAM, RAM usage, trend badges, 40-sample sparklines and a stale-data state.
- **Wi-Fi diagnostics** — signal percentage, RSSI, channel, SSID, local IP, gateway, subnet, MAC and DNS, plus TCP latency probes to the gateway and one of three targets: Google, Cloudflare or Telkom.
- **Standby clock** — NTP time from `pool.ntp.org` at GMT+7, with a date line and seconds meter. There is no RTC; the clock depends on Wi-Fi and NTP.
- **Pomodoro** — 10, 15, 25 and 45-minute presets, 1–60 minute manual adjustment, start/pause/resume/reset, a 24-block progress wave, a five-dot session display and an eight-second PWM backlight alarm.
- **Animations** — 24-column Matrix rain with 80–160 px/s fall speeds, a 50-star 3D starfield, a bouncing DVD sprite and an on-screen measured-FPS HUD.
- **Settings** — six saved Wi-Fi profiles, each with its own password and JSON endpoint, plus 18 RGB565 themes in a three-page gallery. Profiles, endpoints and the selected theme are stored in NVS.
- **Touch UI** — header tabs, tappable cards, long-press to forget a network, swipe paging in the theme gallery and a physical BOOT-button page shortcut.

## Screens

| Screen | Purpose |
| --- | --- |
| **Monitor** | CPU/GPU cards, RAM card, 40-sample sparklines and a Wi-Fi diagnostics sub-page. |
| **Clock** | NTP standby clock and the Pomodoro timer. |
| **Animation** | Matrix rain, 3D starfield and bouncing DVD modes. |
| **Settings** | Saved networks and the 18-theme gallery. |

The web demo contains all four screens in [web/index.html](web/index.html); [web/app.html](web/app.html) opens the interface alone, without the surrounding project page.

## Architecture

```text
LibreHardwareMonitor on a Windows PC
  └─ Options → Remote Web Server → Run
       └─ http://<pc-ip>:8085/data.json
              │
              │  Wi-Fi / HTTP
              ▼
ESP32-3248S035
  ├─ httpFetchTask (core 0, priority 1, 12 KB stack)
  │    └─ JSON filter → sensor scan → LiveData snapshot
  ├─ NVS (Preferences)
  │    └─ theme, six Wi-Fi profiles, per-profile endpoint
  └─ TFT_eSPI 480 × 320
       ├─ Monitor
       ├─ Clock / Pomodoro
       ├─ Animation
       └─ Settings
```

The fetch task runs only while the Monitor page is on its hardware sub-page. It applies a JSON filter and a nesting limit before scanning, then commits the snapshot to the UI. The full LibreHardwareMonitor tree is roughly 120 KB, so keeping unused fields would put unnecessary pressure on the ESP32 heap.

## Hardware

| Item | Detail |
| --- | --- |
| Board | ESP32-3248S035 (CYD 3.5″) |
| MCU | ESP32, dual-core 240 MHz |
| Display | ST7796, 480 × 320, landscape |
| Display SPI | 65 MHz |
| Touch | TFT_eSPI touch controller, CS 33, 2.5 MHz |
| Backlight | GPIO 27, PWM |
| Light sensor | LDR on GPIO 34 |
| Page shortcut | BOOT button on GPIO 0 |
| TFT pins | MOSI 13, MISO 12, SCLK 14, CS 15, DC 2 |
| Storage | ESP32 Preferences (NVS) |

The pin map, display driver, SPI speeds and partition table are defined in [`platformio.ini`](platformio.ini). The firmware is a single translation unit in [`src/main.cpp`](src/main.cpp).

## Firmware notes

- **Stack:** Arduino framework with TFT_eSPI `^2.5.43`, ArduinoJson `^7.0.0` and WiFiManager.
- **Board target:** `esp32dev` with the `huge_app.csv` partition.
- **Telemetry fetch:** HTTP connect timeout 4 s, response timeout 10 s, JSON nesting limit 12.
- **Polling:** the fetch task delays 400 ms after each request while the Monitor hardware view is active. History samples are pushed about once per second.
- **Themes:** 18 palettes in RGB565, shown six at a time in a two-column, three-row gallery. The selection is written to NVS. The firmware restores the last saved theme and falls back to DUO-TONE on first boot; the web demo defaults to E-INK.
- **Brightness:** the LDR is smoothed and mapped to a PWM duty range of 15–255. During a Pomodoro alarm, the backlight blinks for eight seconds.
- **Time:** `configTime()` with `pool.ntp.org`, GMT+7 and no daylight-saving offset.
- **Networking:** six saved profiles are tried automatically. If no profile connects, the board starts the `CYD-MONITOR-AP` captive portal and restarts after the 240-second portal timeout.

## Web demo

The web folder is a dependency-free static site:

- [web/index.html](web/index.html) — project landing page with an embedded interactive simulator.
- [web/app.html](web/app.html) — the four-screen CYD interface on its own, scaled to fill the browser.
- [web/app.css](web/app.css) — full-page layout for the standalone interface.
- [web/styles.css](web/styles.css) — site and simulated-device styling.
- [web/app.js](web/app.js) — theme engine, simulated telemetry, touch interactions and navigation.

The site uses the same 18 RGB565 palettes as the firmware and defaults to the light **E-INK** theme. The demo uses generated telemetry, not real sensor data.

## Repository layout

```text
.
├── src/
│   └── main.cpp              # ESP32 firmware
├── platformio.ini            # board, libraries, display and touch configuration
├── web/
│   ├── index.html            # portfolio page + embedded simulator
│   ├── app.html              # standalone CYD interface
│   ├── app.css               # standalone page layout
│   ├── app.js                # simulator and theme engine
│   └── styles.css            # site + simulated-device styles
├── docs/
│   └── preview.png           # browser demo screenshot
├── deploy/
│   └── nginx.conf            # static container server config
├── Dockerfile                # Nginx image for the web experience
├── docker-compose.yml        # local container workflow
├── .dockerignore
└── README.md
```

## Getting started

### 1. Build and flash the firmware

Prerequisites:

- PlatformIO Core or the PlatformIO VS Code extension.
- An ESP32-3248S035 board connected over USB.
- A 2.4 GHz Wi-Fi network.

```bash
pio run
pio run --target upload
pio device monitor -b 115200
```

On first boot, the board opens the setup access point:

- SSID: `CYD-MONITOR-AP`
- Password: `password123`

Connect to it, open `http://192.168.4.1`, choose the Wi-Fi network and paste the LibreHardwareMonitor JSON URL. The profile is saved in NVS. Change `WIFI_AP_PASS` in `src/main.cpp` before deploying the board outside a trusted setup environment.

### 2. Start LibreHardwareMonitor

1. Run LibreHardwareMonitor on the Windows PC that owns the sensors. Administrator access is usually required for full sensor coverage.
2. Open **Options → Remote Web Server → Run**.
3. Confirm that `http://<pc-ip>:8085/data.json` opens from another device on the same LAN.
4. Allow port 8085 through Windows Firewall if necessary.
5. Enter that URL in the CYD setup portal.

The default firmware URL is `http://192.168.1.50:8085/data.json`; replace it with the address of your PC.

### 3. Run the web demo

From the repository root:

```bash
cd web
python -m http.server 8099
```

Open `http://127.0.0.1:8099/` for the landing page or `http://127.0.0.1:8099/app.html` for the standalone interface. Port 8099 is only a local example; port 8085 is normally reserved for LibreHardwareMonitor.

## Docker

The container packages the complete static web experience: the landing page, the embedded simulator and the full-screen app. Firmware is still built and flashed with PlatformIO.

```bash
docker compose up --build
```

Open `http://localhost:8080/`.

Or without Compose:

```bash
docker build -t cyd-monitor .
docker run --rm -p 8080:80 cyd-monitor
```

The image uses Nginx, serves `web/` from `/usr/share/nginx/html`, exposes a `/healthz` endpoint and adds baseline security headers.

## Configuration

| Setting | Current value | Where |
| --- | --- | --- |
| Board | `esp32dev` | `platformio.ini` |
| Partition table | `huge_app.csv` | `platformio.ini` |
| Display driver | ST7796 | `platformio.ini` |
| Display SPI | 65 MHz | `platformio.ini` |
| Touch SPI | 2.5 MHz | `platformio.ini` |
| Default data URL | `http://192.168.1.50:8085/data.json` | `src/main.cpp` |
| Setup AP | `CYD-MONITOR-AP` | `src/main.cpp` |
| Saved Wi-Fi profiles | 6 | `src/main.cpp` |
| NTP server | `pool.ntp.org` | `src/main.cpp` |
| Time zone | GMT+7 | `src/main.cpp` |
| Themes | 18, saved in NVS | `src/main.cpp` |
| Web default theme | E-INK | `web/app.js` |
| Container port | 80 (mapped to 8080 by Compose) | `Dockerfile`, `docker-compose.yml` |

## Limitations

- Real telemetry requires a Windows PC running LibreHardwareMonitor with its remote web server enabled.
- ESP32 Wi-Fi is 2.4 GHz only; 5 GHz-only networks will not work.
- The telemetry endpoint is plain HTTP by default and there is no user account. Run the project on a trusted LAN.
- The firmware is configured for the ESP32-3248S035 pin map and ST7796 panel. Other CYD variants may need changes in `platformio.ini` and `src/main.cpp`.
- Sensor naming varies by motherboard and GPU. The scanner uses heuristics and falls back to a no-data state when a field is unavailable.
- The browser demo is a static simulation, not a remote control.
- There is no RTC, so the clock needs a working Wi-Fi connection and NTP sync.

## Acknowledgements

- [TFT_eSPI](https://github.com/Bodmer/TFT_eSPI) by Bodmer
- [ArduinoJson](https://arduinojson.org/) by Benoit Blanchon
- [WiFiManager](https://github.com/tzapu/WiFiManager) by tzapu
- [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor)
- [PlatformIO](https://platformio.org/)
- [Nginx](https://nginx.org/) and [Docker](https://www.docker.com/)
