# CYD Monitor web app

Static, dependency-free web pages for the CYD Monitor project. The pages mirror the firmware's four CYD screens and work on phones, laptops and desktop browsers. The full project overview, firmware build instructions and Docker notes live in the [root README](../README.md).

## Pages and files

- `index.html` — project landing page with an embedded 480 × 320 simulator.
- `app.html` — the standalone CYD screens without site chrome: Monitor, Clock/Pomodoro, Animation and Settings.
- `app.css` — fluid full-screen layout for `app.html`.
- `app-live.js` — live LibreHardwareMonitor scanner, browser clock, Pomodoro, animations, source setup and persistence.
- `app.js` — theme engine and generated telemetry for the landing-page simulator.
- `theme-data.js` — the 18 shared RGB565 palettes from `src/main.cpp`.
- `styles.css` — landing-page and simulated-device styling.

## Run locally

Serve the folder over HTTP from `web/`:

```bash
cd web
python -m http.server 8099
```

Open:

- `http://127.0.0.1:8099/` — landing page and simulator.
- `http://127.0.0.1:8099/app.html` — standalone CYD interface.

Port 8085 is normally used by LibreHardwareMonitor, so these examples use 8099. Do not open `app.html` directly from the filesystem; the browser needs an HTTP origin to fetch a live source.

## Live LibreHardwareMonitor data

1. Run LibreHardwareMonitor on the Windows PC that owns the sensors.
2. Open **Options → Remote Web Server → Run**.
3. Confirm that `http://<pc-ip>:8085/data.json` opens on another device on the same LAN.
4. Open `app.html` through the local HTTP server above.
5. Enter the `data.json` URL in the setup screen and choose **Test & connect**.

LibreHardwareMonitor sends `Access-Control-Allow-Origin: *` by default. If it does not, the browser cannot read the response even when the URL opens in a new tab.

LibreHardwareMonitor's built-in server only serves the exact `/data.json` path. Query strings such as `/data.json?x=1` return **404 Not Found** and no CORS header. The app fetches the URL exactly as entered with browser caching disabled, so it does not append a cache-busting query.

### HTTP and HTTPS

The app must be served over HTTP or localhost when LHM is also HTTP. An HTTPS page cannot fetch an HTTP endpoint because browsers block mixed content. If the app is deployed over HTTPS, expose LibreHardwareMonitor through an HTTPS proxy or reverse proxy.

### Demo fallback

The landing-page simulator is generated locally. The standalone app can use generated telemetry too, but demo mode is always labeled **DEMO** and never silently replaces a live source. If a live source fails, the app keeps the last values and shows **STALE**, or **OFFLINE** if no successful update has arrived yet.

## Behavior and limits

- The Monitor view mirrors the CYD cards for CPU, GPU and RAM, including trend badges, load bars and 40-sample sparklines.
- The Clock view uses the browser's local time and shows the computed GMT offset. Unlike the firmware, the web app does not require NTP.
- Pomodoro presets, progress blocks, session dots and the start/pause/reset controls work locally in the browser.
- Animations include Matrix rain, a 3D starfield and a bouncing DVD sprite, with a measured-FPS HUD.
- Settings has **Sources**, **Themes** and **Style** tabs. The theme gallery uses the same 18 palettes and fits as many title-and-color cards per page as the available screen space allows.
- The **Style** tab has a Neo Brutalist switch. It adds thick outlines, hard offset shadows and square corners to every screen while keeping the selected color theme.
- The app asks only for the LibreHardwareMonitor `data.json` URL. It does not ask for or store Wi-Fi passwords.
- The endpoint URL, selected theme and style are stored in browser local storage.
- Browser pages cannot read SSID, RSSI, channel, local IP, gateway, subnet or DNS. The web diagnostics show only browser facts, fetch status, latency and request history.
- The app is read-only and never controls the ESP32.

## Docker

The root `Dockerfile` packages `web/` with Nginx. From the repository root:

```bash
docker compose up --build
```

Open `http://localhost:8080/`.
