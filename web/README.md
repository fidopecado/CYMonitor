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

- **Monitor** — animated CPU/GPU/RAM telemetry, 40-sample sparklines, trend badges
  and the Wi-Fi diagnostics sub-page with cycling ping targets.
- **Clock** — NTP-style GMT+7 clock, 60-tick seconds meter and a working Pomodoro
  timer (start/pause/reset, presets, session dots, completion alarm).
- **Animation** — Matrix rain, 3D starfield, bouncing DVD and the real GIF that is
  embedded in `src/gif_data.h` (`assets/demo.gif`).
- **Settings** — all 15 theme palettes from `src/main.cpp`, scroll/drag gallery,
  instant theme application.

The 15 palettes are the exact RGB565 values declared in `main.cpp` and are converted
to RGB at runtime. Navigation, chips and cards mirror the firmware's touch map.

Everything runs in the browser; no hardware or network calls are made.
