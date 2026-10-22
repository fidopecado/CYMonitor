# CYD Monitor — website & interactive demo

A static, dependency-free site that presents the ESP32-3248S035 project and simulates
the firmware UI pixel-for-pixel at 480 × 320.

## Run it

Open `index.html` directly, or serve the folder:

```powershell
python -m http.server 8085
# http://127.0.0.1:8085/
```

Two pages are available:

- `index.html` — project landing page with the embedded 480 × 320 simulator.
- `app.html` — the CYD interface on its own, with no page chrome: just the
  Monitor, Clock, Animation and Settings screens scaled to fill the browser.
  Use it on a phone in landscape or a spare laptop.

The landing page uses a neobrutalist system: 3 px ink outlines, hard offset shadows,
flat fills, bold system-ui type and an asymmetric two-column feature layout. It still
follows the selected CYD theme, so its background, accents and chrome are derived from
the active palette. The site and simulator now boot in the light **E-INK** palette;
pick any of the other 17 themes from the strip or the Settings gallery. Text, accent
and button contrast are computed per theme, so every outline, surface and label stays
readable in all 18 themes.

## What is simulated

- **Monitor** — animated CPU/GPU/RAM telemetry, adaptive hardware names, 40-sample
  sparklines, trend badges, a no-data state and the Wi-Fi diagnostics sub-page with
  cycling ping targets.
- **Clock** — flat firmware-style standby clock with an NTP-style GMT+7 time,
  60-tick seconds meter and a working Pomodoro timer: start / pause / resume / reset,
  presets, session dots, a completion alarm and the 24-block wave progress bar.
  The countdown stays clear of the progress indicator and action labels stay centered.
- **Animation** — full-width Matrix rain with 24 columns, randomized trails and
  80–160 px/s speed, plus the 3D starfield and bouncing DVD modes. The embedded GIF
  was removed from the firmware to save flash.
- **Settings** — two sub-tabs. **NETWORKS** shows up to six saved Wi-Fi profiles,
  each with its own source URL; tap to connect or hold to forget. **THEMES** shows
  all 18 palettes in a three-page gallery with wheel/swipe paging and a page
  indicator. The selected theme is highlighted with a gold border and accent bar
  instead of an “OK” badge.

The 18 palettes — including the low-contrast E-INK, AURORA, SAKURA and COPPER sets —
are the exact RGB565 values declared in `src/main.cpp` and are converted to RGB at
runtime. Navigation, chips, cards, clock, Pomodoro and animation layout mirror the
firmware's touch map.

Everything runs in the browser; no hardware or network calls are made.
