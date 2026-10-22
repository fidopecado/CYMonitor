# CYD Monitor web demo

Static, dependency-free web pages for the CYD Monitor project. The full project overview, firmware build instructions and Docker notes live in the [root README](../README.md).

## Pages

- `index.html` — portfolio landing page with an embedded 480 × 320 simulator.
- `app.html` — the CYD interface on its own, without site chrome, scaled to fill the browser.
- `app.css` — full-page layout for `app.html`.
- `styles.css` — site and simulated-device styling.
- `app.js` — theme engine, generated telemetry and simulator interactions.

## Run locally

```bash
python -m http.server 8099
```

Open `http://127.0.0.1:8099/` or `http://127.0.0.1:8099/app.html`.

Port 8085 is normally used by LibreHardwareMonitor, so the demo uses 8099 in these examples.

## Notes

- The site defaults to the light **E-INK** palette. All 18 palettes are the RGB565 values declared in `src/main.cpp`, converted to RGB in the browser.
- Telemetry is simulated; the demo makes no network requests to the ESP32 or LibreHardwareMonitor.
- The simulator includes the Monitor, Clock, Animation and Settings screens, including the Pomodoro timer, theme gallery and saved-network states.
- The page has no build step and no third-party runtime dependencies.
- To serve the same files in a container, use the root `Dockerfile` or `docker compose up --build`.
