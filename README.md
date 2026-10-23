# CYD Monitor

A touch-first ESP32 desk display for live PC telemetry, built around the **ESP32-3248S035 “CYD” 3.5″ board** and **LibreHardwareMonitor**.

The firmware polls a local LibreHardwareMonitor JSON endpoint over Wi-Fi, scans the hardware tree for CPU, GPU and RAM sensors, and renders the results on a 480 × 320 TFT with TFT_eSPI. The repository also includes a browser version of the same CYD screens, with an optional live connection to LibreHardwareMonitor, and a Docker image that serves the complete web experience.

![CYD Monitor landing page with the embedded simulator](docs/preview.png)

*Browser demo preview. The landing-page simulator uses generated telemetry; the standalone app can read real sensors from LibreHardwareMonitor.*

> The landing-page simulator is generated. The standalone web app at [`web/app.html`](web/app.html) can fetch a LibreHardwareMonitor `data.json` endpoint directly; it never controls the ESP32.

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

The web version contains all four screens. [web/index.html](web/index.html) is the project landing page with an embedded simulator; [web/app.html](web/app.html) opens the CYD interface alone, without site chrome, and can connect to a live LibreHardwareMonitor source.

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

## Web app

The web folder is a dependency-free static site with two entry points:

- [web/index.html](web/index.html) — project landing page with an embedded, generated-telemetry simulator.
- [web/app.html](web/app.html) — the CYD screens alone: Monitor, Clock/Pomodoro, Animation and Settings.
- [web/app.css](web/app.css) — fluid full-screen layout for the standalone app.
- [web/app-live.js](web/app-live.js) — live LibreHardwareMonitor scanner, browser clock, Pomodoro, animations, settings and source handling.
- [web/app.js](web/app.js) — theme engine and generated telemetry for the landing-page simulator.
- [web/theme-data.js](web/theme-data.js) — the shared 18 RGB565 palettes.
- [web/styles.css](web/styles.css) — landing-page and simulated-device styling.

The standalone app is designed as a web representation of the CYD screens, not a separate dashboard. It fills the available browser or phone viewport, uses the same palette set as the firmware, and keeps the CYD tab structure and screen hierarchy. Clock mode uses the browser's local time and shows the computed GMT offset; there is no NTP requirement on the web.

### Live LibreHardwareMonitor data

1. Start LibreHardwareMonitor on the Windows PC that owns the sensors.
2. Open **Options → Remote Web Server → Run**.
3. Confirm `http://<pc-ip>:8085/data.json` opens in a browser on the same network.
4. Serve this folder over HTTP (for example `python -m http.server 8099` from `web/`) and open `http://127.0.0.1:8099/app.html`.
5. Enter the `data.json` URL in the setup screen.

LibreHardwareMonitor sends `Access-Control-Allow-Origin: *` by default, so the app can fetch it directly. Use the plain `/data.json` URL: LHM's built-in server returns 404 for URLs with query strings such as `/data.json?x=1`. The page must be served over HTTP or localhost: an HTTPS page cannot fetch an HTTP endpoint because browsers block mixed content. The app does not request Wi-Fi credentials. The endpoint URL is stored only in browser local storage.

If the source cannot be reached, the app shows a clearly labeled **DEMO** mode or a **STALE/OFFLINE** state; live values are never silently replaced by generated ones. The landing-page simulator remains generated and is labeled as such.

## Repository layout

```text
.
├── src/
│   └── main.cpp              # ESP32 firmware
├── platformio.ini            # board, libraries, display and touch configuration
├── web/
│   ├── index.html            # portfolio page + embedded simulator
│   ├── app.html              # standalone CYD screens
│   ├── app.css               # full-screen CYD layout
│   ├── app-live.js           # live LibreHardwareMonitor runtime
│   ├── app.js                # landing simulator
│   ├── theme-data.js         # shared 18 RGB565 palettes
│   └── styles.css            # landing page + simulated-device styles
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

### 3. Run the web app

From the repository root:

```bash
cd web
python -m http.server 8099
```

Open `http://127.0.0.1:8099/` for the landing page or `http://127.0.0.1:8099/app.html` for the full-screen CYD interface. In the standalone app, either choose **Demo data** or paste the LibreHardwareMonitor `data.json` URL to connect live.

Port 8099 is only a local example; port 8085 is normally reserved for LibreHardwareMonitor. Serve the app over HTTP or localhost rather than opening `app.html` from the filesystem. An HTTPS deployment cannot fetch an HTTP LibreHardwareMonitor endpoint because of mixed-content blocking; use an HTTPS proxy for LHM if you need HTTPS.

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
| Web themes | 18, shared with the firmware palettes | `web/theme-data.js` |
| Web default theme | E-INK | `web/app-live.js`, `web/app.js` |
| Web clock | Browser local time and computed GMT offset | `web/app-live.js` |
| Web live source | Configurable LibreHardwareMonitor `data.json` URL | `web/app.html` setup screen |
| Container port | 80 (mapped to 8080 by Compose) | `Dockerfile`, `docker-compose.yml` |

## Limitations

- Real telemetry requires a Windows PC running LibreHardwareMonitor with its remote web server enabled.
- ESP32 Wi-Fi is 2.4 GHz only; 5 GHz-only networks will not work.
- The telemetry endpoint is plain HTTP by default and there is no user account. Run the project on a trusted LAN.
- The firmware is configured for the ESP32-3248S035 pin map and ST7796 panel. Other CYD variants may need changes in `platformio.ini` and `src/main.cpp`.
- Sensor naming varies by motherboard and GPU. The scanner uses heuristics and falls back to a no-data state when a field is unavailable.
- The browser app is read-only; it does not remote-control the ESP32.
- Live browser data requires LibreHardwareMonitor's Remote Web Server and a CORS-permitting endpoint. The app handles generated demo data separately and labels it.
- Browsers do not expose SSID, RSSI, local IP, gateway or DNS to web pages, so the web diagnostics show only observable browser and fetch facts.
- There is no RTC on the CYD, so the firmware clock needs a working Wi-Fi connection and NTP sync. The web clock uses the device's local time instead.

## Acknowledgements

- [TFT_eSPI](https://github.com/Bodmer/TFT_eSPI) by Bodmer
- [ArduinoJson](https://arduinojson.org/) by Benoit Blanchon
- [WiFiManager](https://github.com/tzapu/WiFiManager) by tzapu
- [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor)
- [PlatformIO](https://platformio.org/)
- [Nginx](https://nginx.org/) and [Docker](https://www.docker.com/)
