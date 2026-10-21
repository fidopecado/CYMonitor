# CYD Monitor — website & interactive demo

A static, dependency-free site that presents the ESP32-3248S035 project and simulates
the firmware UI pixel-for-pixel at 480 × 320.

## Run it

Open `index.html` directly, or serve the folder:

```powershell
python -m http.server 8085
# http://127.0.0.1:8085/
```

## What is simulated

- **Monitor** — animated CPU/GPU/RAM telemetry, adaptive hardware names, 40-sample
  sparklines, trend badges, a no-data state and the Wi-Fi diagnostics sub-page with
  cycling ping targets.
- **Clock** — NTP-style GMT+7 clock, 60-tick seconds meter and a working Pomodoro
  timer (start/pause/reset, presets, session dots, completion alarm).
- **Animation** — Matrix rain, 3D starfield and bouncing DVD. The embedded GIF was
  removed from the firmware to save flash.
- **Settings** — two sub-tabs. **NETWORKS** shows up to six saved Wi-Fi profiles,
  each with its own source URL; tap to connect or hold to forget. **THEMES** shows
  all 15 palettes in a scroll/drag gallery. The selected theme is highlighted with a
  gold border and accent bar instead of an “OK” badge.

The 15 palettes are the exact RGB565 values declared in `src/main.cpp` and are converted
to RGB at runtime. Navigation, chips and cards mirror the firmware's touch map.

Everything runs in the browser; no hardware or network calls are made.
