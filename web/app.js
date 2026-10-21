/* ==========================================================================
   CYD Monitor — interactive simulation of src/main.cpp
   ========================================================================== */
(() => {
  'use strict';

  // ------------------------------------------------------------------------
  // 15 theme palettes, exactly as declared in main.cpp (RGB565)
  // order: bg, cardBg, cardBorder, headerBg, barTrack, textWhite, textMuted,
  //        textDark, tempCool, tempWarm, tempHot, accent1, accent2, accent3,
  //        gold
  // ------------------------------------------------------------------------
  const THEMES = [
    { name: 'DUO-TONE',     c: [0x0841, 0x1082, 0x39E7, 0x0841, 0x2945, 0xFFFF, 0xAD75, 0x528A, 0x051F, 0xFD20, 0xF800, 0x051F, 0xFC40, 0x051F, 0xFC40] },
    { name: 'E-INK',        c: [0xF7BE, 0xCE59, 0x4208, 0xDF1C, 0xD69A, 0x4A49, 0x4208, 0x8410, 0x4208, 0x2104, 0x4A49, 0x4A49, 0x31A6, 0x630C, 0x9492] },
    { name: 'EMERALD',      c: [0x0183, 0x0A26, 0x1B8A, 0x0102, 0x0A47, 0xEFEF, 0x7E31, 0x33A6, 0x07E0, 0xFDE0, 0xF9A0, 0x07E0, 0x07EF, 0x366B, 0xFFE0] },
    { name: 'DRACULA',      c: [0x280D, 0x3852, 0x6277, 0x200A, 0x4896, 0xF79E, 0x9E3B, 0x5291, 0x57FF, 0xFAAA, 0xF888, 0xFAAA, 0x57FF, 0xAF7D, 0xFEA0] },
    { name: 'DEEP OCEAN',   c: [0x000B, 0x016E, 0x0375, 0x0007, 0x0272, 0xE7FF, 0x74FE, 0x33B3, 0x07FF, 0x05BD, 0xF9E7, 0x07FF, 0x041F, 0x367F, 0x7FFF] },
    { name: 'SUNSET',       c: [0x1805, 0x2809, 0x590E, 0x1003, 0x386A, 0xFFFE, 0xD4B3, 0x72AA, 0xFE20, 0xFD20, 0xF800, 0xFC40, 0xF814, 0xFD60, 0xFFE0] },
    { name: 'SOLARIZED',    c: [0x002B, 0x086E, 0x2A73, 0x0027, 0x18B0, 0x94B2, 0x5395, 0x2A73, 0x2C40, 0xB400, 0xD800, 0x2B8F, 0xB400, 0x2C40, 0xCB20] },
    { name: 'AMBER CRT',    c: [0x0000, 0x1080, 0x4200, 0x0800, 0x2100, 0xFFE0, 0xC400, 0x6200, 0xFF40, 0xFD20, 0xF800, 0xFFE0, 0xFC00, 0xD400, 0xFFE0] },
    { name: 'NEON MATRIX',  c: [0x0000, 0x0100, 0x0380, 0x0080, 0x0200, 0x07E0, 0x04A0, 0x0280, 0x07E0, 0xAFE0, 0xF800, 0x07E0, 0x37E0, 0x05E0, 0xB7E0] },
    { name: 'MIDNIGHT',     c: [0x0000, 0x1002, 0x3809, 0x0801, 0x2005, 0xFFFF, 0x9013, 0x400A, 0x901F, 0xF80F, 0xF800, 0xC81F, 0xF80F, 0x601F, 0xFBC0] },
    { name: 'CRIMSON RED',  c: [0x1800, 0x3000, 0x8000, 0x2000, 0x4000, 0xFFFF, 0xD510, 0x6000, 0x07E0, 0xFD20, 0xF800, 0xDC07, 0xF800, 0xFC00, 0xFFE0] },
    { name: 'DEEP MAROON',  c: [0x1000, 0x2802, 0x6004, 0x1801, 0x4002, 0xFFFB, 0xB3E7, 0x5001, 0x07E0, 0xFD20, 0xF800, 0x8000, 0xA002, 0xD005, 0xFEA0] },
    { name: 'CYBER RED',    c: [0x0000, 0x1000, 0xF800, 0x0800, 0x3000, 0xFFFF, 0xF9E7, 0x6000, 0x07E0, 0xFD20, 0xF800, 0xFA4B, 0xF800, 0xFC00, 0xFFE0] },
    { name: 'RUBY WINE',    c: [0x1002, 0x2805, 0x7809, 0x1803, 0x3807, 0xFFFE, 0xC3B2, 0x5003, 0x07E0, 0xFD20, 0xF800, 0x9805, 0xC008, 0xE80A, 0xFD60] },
    { name: 'VERMILION',    c: [0x1800, 0x2880, 0x7A00, 0x2000, 0x4100, 0xFFFF, 0xDC05, 0x5800, 0x07E0, 0xFD20, 0xF800, 0xE206, 0xF9A0, 0xFB00, 0xFFE0] },
  ];

  const VAR_NAMES = ['bg', 'card', 'border', 'header', 'track', 'white', 'muted', 'dark', 'cool', 'warm', 'hot', 'a1', 'a2', 'a3', 'gold'];

  const toHex = (v) => {
    const r = (v >> 11) & 0x1f;
    const g = (v >> 5) & 0x3f;
    const b = v & 0x1f;
    const c = (n, max) => Math.round((n * 255) / max);
    return '#' + [c(r, 31), c(g, 63), c(b, 31)].map((n) => n.toString(16).padStart(2, '0')).join('');
  };

  const PALETTES = THEMES.map((t) => {
    const vars = {};
    VAR_NAMES.forEach((name, i) => { vars[name] = toHex(t.c[i]); });
    return { name: t.name, vars };
  });

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const fmt = (n, d = 1) => n.toFixed(d);

  const screen = $('#screen');
  const viewport = $('#viewport');

  const state = {
    page: 0,
    monitorSub: 0,
    clockSub: 0,
    theme: 0,
    anim: 0,
    ping: 0,
    rssi: -52,
    pal: PALETTES[0].vars,
    scale: 1,
    cpu: { name: 'AMD RYZEN 5 5600', temp: 47.2, load: 18.4, power: 65.3, fan: 1180 },
    gpu: { name: 'RX 6700 XT', hasHotspot: true, core: 55.6, hot: 67.2, load: 22.1, vram: 5312 },
    ram: { pct: 38.7, used: 12.4, total: 32 },
    latency: { gw: 4, srv: 14 },
    pomo: { active: false, paused: false, finished: false, minutes: 25, remaining: 0, duration: 0, endAt: 0, sessions: 0 },
    scroll: 0,
    settingsTab: 0,
    activeNetwork: 0,
    networks: [
      { ssid: 'HOME-5G', url: 'http://192.168.1.50:8085/data.json' },
      { ssid: 'LAPTOP-HOTSPOT', url: 'http://192.168.0.224:8085/data.json' },
      { ssid: 'OFFICE-2.4G', url: 'http://10.0.0.42:8085/data.json' },
    ],
  };

  // ------------------------------------------------------------------------
  // screen scaling — keep the 480×320 layout intact and scale to the bezel
  // ------------------------------------------------------------------------
  function fitScreen() {
    const w = viewport.clientWidth;
    if (!w) return;
    const s = w / 480;
    state.scale = s;
    screen.style.transform = `scale(${s})`;
    viewport.style.height = 320 * s + 'px';
  }
  if ('ResizeObserver' in window) new ResizeObserver(fitScreen).observe(viewport);
  window.addEventListener('resize', fitScreen);
  fitScreen();

  // ------------------------------------------------------------------------
  // theme application
  // ------------------------------------------------------------------------
  function applyTheme(index) {
    const t = PALETTES[index];
    state.theme = index;
    state.pal = t.vars;
    VAR_NAMES.forEach((name) => screen.style.setProperty('--' + name, t.vars[name]));

    $$('.theme-dot').forEach((d) => {
      const on = Number(d.dataset.theme) === index;
      d.classList.toggle('active', on);
      d.setAttribute('aria-pressed', String(on));
    });

    renderThemeCards();
    drawSpark('cpuSpark');
    drawSpark('gpuSpark');
  }

  // ------------------------------------------------------------------------
  // page + subpage navigation
  // ------------------------------------------------------------------------
  const pages = $$('.page');
  const tabButtons = $$('.tab');
  const navButtons = $$('.screen-nav button');

  function setPage(page) {
    state.page = page;
    pages.forEach((p) => p.classList.toggle('on', Number(p.dataset.page) === page));
    tabButtons.forEach((t) => {
      const on = Number(t.dataset.page) === page;
      t.classList.toggle('active', on);
      t.setAttribute('aria-pressed', String(on));
    });
    navButtons.forEach((b) => {
      const on = Number(b.dataset.page) === page;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    if (page === 2) initAnimation();
  }

  tabButtons.forEach((t) => t.addEventListener('click', () => setPage(Number(t.dataset.page))));
  navButtons.forEach((b) => b.addEventListener('click', () => setPage(Number(b.dataset.page))));

  // monitor: hardware <-> wifi diagnostics
  const monPanels = $$('.mon-panel');
  function setMonitorSub(sub) {
    state.monitorSub = sub;
    monPanels.forEach((p) => { p.hidden = Number(p.dataset.sub) !== sub; });
    if (sub === 1) updateWifiPanel(true);
  }
  $('#toDiag').addEventListener('click', () => setMonitorSub(1));
  $('#toHw').addEventListener('click', () => setMonitorSub(0));

  // clock: clock <-> pomodoro
  const clockPanels = $$('.clock-panel');
  function setClockSub(sub) {
    state.clockSub = sub;
    clockPanels.forEach((p) => { p.hidden = Number(p.dataset.sub) !== sub; });
    updateClock(true);
    updatePomodoro(true);
  }
  $('#toPomo').addEventListener('click', () => setClockSub(1));
  $('#toClock').addEventListener('click', () => setClockSub(0));

  // ------------------------------------------------------------------------
  // live hardware telemetry (simulated)
  // ------------------------------------------------------------------------
  const cpuHist = Array.from({ length: 40 }, (_, i) => 45 + Math.sin(i / 4.5) * 4 + Math.random() * 2);
  const gpuHist = Array.from({ length: 40 }, (_, i) => 55 + Math.cos(i / 6) * 5 + Math.random() * 2);

  const tempColor = (t) => (t < 55 ? 'var(--cool)' : t < 75 ? 'var(--warm)' : 'var(--hot)');
  const usageColor = (p) => (p < 60 ? 'var(--cool)' : p < 85 ? 'var(--warm)' : 'var(--hot)');

  function pushHistory(arr, val) {
    arr.shift();
    arr.push(val);
  }

  function trendDelta(arr) {
    return arr[arr.length - 1] - arr[arr.length - 2];
  }

  function renderTrend(el, delta) {
    if (delta > 0.3) {
      el.style.color = 'var(--warm)';
      el.innerHTML = '<span>▲</span><span>+' + fmt(delta) + '</span>';
    } else if (delta < -0.3) {
      el.style.color = 'var(--cool)';
      el.innerHTML = '<span>▼</span><span>' + fmt(delta) + '</span>';
    } else {
      el.style.color = 'var(--muted)';
      el.innerHTML = '<span>—</span><span>STABLE</span>';
    }
  }

  function updateMonitor() {
    const { cpu, gpu, ram } = state;
    const activeNetwork = state.networks[state.activeNetwork];

    $('#cpuName').textContent = cpu.name;
    const cpuTempEl = $('#cpuTemp');
    cpuTempEl.textContent = fmt(cpu.temp);
    cpuTempEl.style.color = tempColor(cpu.temp);
    $('#cpuLoad').textContent = fmt(cpu.load) + '%';
    $('#cpuBar').style.width = clamp(cpu.load, 0, 100) + '%';
    $('#cpuBar').style.background = usageColor(cpu.load);
    $('#cpuExtra').textContent = cpu.fan > 0 ? cpu.fan + ' RPM' : fmt(cpu.power, 0) + ' W';
    renderTrend($('#cpuTrend'), trendDelta(cpuHist));

    $('#gpuName').textContent = gpu.name;
    $('#gpuName').style.maxWidth = gpu.hasHotspot ? '66px' : '162px';
    const gpuTempEl = $('#gpuTemp');
    gpuTempEl.textContent = fmt(gpu.core);
    gpuTempEl.style.color = tempColor(gpu.core);
    $('#gpuLoad').textContent = fmt(gpu.load) + '%';
    $('#gpuBar').style.width = clamp(gpu.load, 0, 100) + '%';
    $('#gpuBar').style.background = usageColor(gpu.load);
    $('#gpuVram').textContent = gpu.vram > 1024 ? 'VRAM: ' + fmt(gpu.vram / 1024) + 'GB' : 'VRAM: ' + Math.round(gpu.vram) + 'MB';

    const hotEl = $('#gpuHot');
    hotEl.style.display = gpu.hasHotspot ? 'flex' : 'none';
    if (gpu.hasHotspot) {
      hotEl.textContent = 'HOT: ' + fmt(gpu.hot) + 'C';
      if (gpu.hot >= 85) {
        hotEl.style.background = 'var(--hot)';
        hotEl.style.color = 'var(--white)';
      } else {
        hotEl.style.background = 'var(--border)';
        hotEl.style.color = 'var(--gold)';
      }
    }
    renderTrend($('#gpuTrend'), trendDelta(gpuHist));

    $('#ramUsed').textContent = fmt(ram.used) + ' / ' + fmt(ram.total) + ' GB';
    const ramPct = $('#ramPct');
    ramPct.textContent = fmt(ram.pct) + '%';
    ramPct.style.color = usageColor(ram.pct);
    $('#ramBar').style.width = clamp(ram.pct, 0, 100) + '%';
    $('#ramBar').style.background = usageColor(ram.pct);
    $('#endpoint').textContent = 'SOURCE: ' + (activeNetwork ? activeNetwork.url : 'NO SOURCE URL');

    drawSpark('cpuSpark');
    drawSpark('gpuSpark');
  }

  function stepTelemetry() {
    const { cpu, gpu, ram } = state;
    cpu.temp = clamp(cpu.temp + (Math.random() - 0.48) * 2.4, 34, 86);
    cpu.load = clamp(cpu.load + (Math.random() - 0.5) * 9, 3, 96);
    cpu.power = clamp(cpu.power + (Math.random() - 0.5) * 4, 24, 110);
    cpu.fan = clamp(Math.round(cpu.fan + (Math.random() - 0.5) * 30), 900, 1600);
    gpu.core = clamp(gpu.core + (Math.random() - 0.48) * 2.8, 38, 88);
    gpu.hot = clamp(gpu.core + 10 + (Math.random() - 0.5) * 3, 45, 98);
    gpu.load = clamp(gpu.load + (Math.random() - 0.5) * 12, 2, 99);
    gpu.vram = clamp(gpu.vram + (Math.random() - 0.5) * 260, 3800, 7800);
    ram.pct = clamp(ram.pct + (Math.random() - 0.5) * 1.8, 26, 72);
    ram.used = (ram.pct / 100) * ram.total;

    pushHistory(cpuHist, cpu.temp);
    pushHistory(gpuHist, gpu.core);

    updateMonitor();
    updateWifiPanel(false);
  }

  // ------------------------------------------------------------------------
  // sparklines (40 samples, 212×104, rendered at 3× for crispness)
  // ------------------------------------------------------------------------
  function drawSpark(id) {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = 212, h = 104;
    ctx.setTransform(3, 0, 0, 3, 0, 0);
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = state.pal.card;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = state.pal.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    ctx.beginPath();
    ctx.moveTo(1, h / 2);
    ctx.lineTo(w - 1, h / 2);
    ctx.stroke();

    const hist = id === 'cpuSpark' ? cpuHist : gpuHist;

    let minVal = 120, maxVal = -10;
    hist.forEach((v) => {
      if (v > 0) { minVal = Math.min(minVal, v); maxVal = Math.max(maxVal, v); }
    });
    if (maxVal - minVal < 8) { maxVal += 4; minVal -= 4; }

    const stepX = (w - 4) / (hist.length - 1);
    let prevX = -1, prevY = -1;
    ctx.beginPath();
    hist.forEach((v, i) => {
      const px = 2 + i * stepX;
      const norm = clamp((v - minVal) / (maxVal - minVal), 0, 1);
      const py = (h - 3) - norm * (h - 6);
      if (prevX !== -1) {
        if (i === 1) ctx.moveTo(prevX, prevY);
        ctx.lineTo(px, py);
      }
      prevX = px; prevY = py;
    });
    ctx.strokeStyle = state.pal[id === 'cpuSpark' ? 'a1' : 'a2'];
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.fillStyle = state.pal.muted;
    ctx.font = '7px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'top';
    ctx.fillText(Math.round(maxVal) + 'C', 4, 3);
    ctx.fillText(Math.round(minVal) + 'C', 4, h - 10);
  }

  // ------------------------------------------------------------------------
  // Wi-Fi header + diagnostics
  // ------------------------------------------------------------------------
  const PING_TARGETS = [
    { name: 'GOOGLE (8.8.8.8)', host: '8.8.8.8', port: 53 },
    { name: 'CLOUDFLARE (1.1.1.1)', host: '1.1.1.1', port: 80 },
    { name: 'TELKOM (180.250.250.250)', host: '180.250.250.250', port: 53 },
  ];

  function updateWifiHeader() {
    const rssi = state.rssi;
    const active = state.networks[state.activeNetwork];
    const ssid = active ? active.ssid : '—';
    let bars = 0;
    if (rssi > -55) bars = 4;
    else if (rssi > -67) bars = 3;
    else if (rssi > -78) bars = 2;
    else if (rssi > -88) bars = 1;

    $$('#wifiBars i').forEach((bar, i) => bar.classList.toggle('on', i < bars));
    $('#rssiLabel').textContent = rssi + 'dB';

    const pct = clamp(2 * (rssi + 100), 0, 100);
    $('#signalPct').textContent = pct + '%';
    $('#rssiLine').textContent = 'RSSI: ' + rssi + ' dBm';
    $('#chLine').textContent = 'CH  : 6';
    $('#ssidLine').textContent = 'SSID: ' + ssid.slice(0, 8);
    $('#cfgSsid').textContent = 'SSID      : ' + ssid;
  }

  function updateWifiPanel(force) {
    if (force) state.rssi = clamp(state.rssi + Math.round((Math.random() - 0.5) * 4), -78, -42);
    state.latency.gw = clamp(state.latency.gw + Math.round((Math.random() - 0.5) * 2), 1, 12);
    state.latency.srv = clamp(state.latency.srv + Math.round((Math.random() - 0.5) * 8), 6, 48);

    $('#pingTarget').textContent = 'TARGET: ' + PING_TARGETS[state.ping].name;
    $('#pingGw').textContent = 'GATEWAY : ' + state.latency.gw + ' ms';
    $('#pingSrv').textContent = 'SERVER  : ' + state.latency.srv + ' ms';
    updateWifiHeader();
  }

  $('#pingCard').addEventListener('click', () => {
    state.ping = (state.ping + 1) % PING_TARGETS.length;
    updateWifiPanel(true);
  });

  // ------------------------------------------------------------------------
  // clock / pomodoro
  // ------------------------------------------------------------------------
  const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  function wibNow() {
    const d = new Date();
    return new Date(d.getTime() + d.getTimezoneOffset() * 60000 + 7 * 3600000);
  }

  const ticksEl = $('#ticks');
  for (let s = 0; s < 60; s++) {
    const tick = document.createElement('i');
    tick.style.left = s * 7 + Math.floor(s / 10) * 4 + 'px';
    ticksEl.appendChild(tick);
  }
  const tickEls = Array.from(ticksEl.children);

  function updateClock(force) {
    const d = wibNow();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    $('#clockTime').textContent = `${hh}:${mm}:${ss}`;
    $('#clockDate').textContent =
      `${DAYS[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    tickEls.forEach((t, i) => t.classList.toggle('on', i <= d.getSeconds()));
    if (force) updatePomodoro(true);
  }

  function pomoSeconds() {
    const p = state.pomo;
    if (p.active || p.paused) return Math.ceil(p.remaining / 1000);
    return p.minutes * 60;
  }

  function updatePomodoro(force) {
    const p = state.pomo;
    const secs = pomoSeconds();
    const mm = String(Math.floor(secs / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    $('#pomoDigits').textContent = `${mm}:${ss}`;

    const status = $('#pomoStatus');
    if (p.finished) {
      status.textContent = 'BREAK TIME!';
      status.style.background = 'var(--hot)';
      status.style.color = 'var(--white)';
    } else if (p.active) {
      status.textContent = 'FOCUSING';
      status.style.background = 'var(--a1)';
      status.style.color = 'var(--bg)';
    } else {
      status.textContent = 'READY';
      status.style.background = 'var(--border)';
      status.style.color = 'var(--muted)';
    }

    const pct = p.duration > 0 && (p.active || p.paused) ? (p.remaining / p.duration) * 100 : 100;
    $('#pomoBar').style.width = clamp(pct, 0, 100) + '%';
    $('#pomoBar').style.background = p.finished ? 'var(--hot)' : p.active ? 'var(--a1)' : 'var(--white)';

    const start = $('#pomoStart');
    start.textContent = p.active ? 'PAUSE' : 'START';
    start.style.background = p.active ? 'var(--warm)' : 'var(--cool)';

    $('#sessionDots').innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const dot = document.createElement('i');
      if (i < p.sessions % 6) dot.className = 'on';
      $('#sessionDots').appendChild(dot);
    }

    $$('.preset').forEach((btn) => {
      const on = Number(btn.dataset.min) === p.minutes;
      btn.style.borderColor = on ? 'var(--gold)' : 'var(--border)';
      btn.style.color = on ? 'var(--gold)' : 'var(--white)';
    });
    if (force) return;
  }

  function refreshPomodoroControls() {
    const locked = state.pomo.active;
    $('#pomoMinus').disabled = locked;
    $('#pomoPlus').disabled = locked;
    $('#pomoMinus').style.opacity = locked ? '.35' : '1';
    $('#pomoPlus').style.opacity = locked ? '.35' : '1';
    $$('.preset').forEach((b) => {
      b.disabled = locked;
      b.style.opacity = locked ? '.45' : '1';
    });
  }

  function tickPomodoro() {
    const p = state.pomo;
    if (!p.active) return;
    p.remaining = p.endAt - Date.now();
    if (p.remaining <= 0) {
      p.remaining = 0;
      p.active = false;
      p.paused = false;
      p.finished = true;
      p.sessions++;
      p.duration = 0;
      screen.classList.remove('flash');
      void screen.offsetWidth;
      screen.classList.add('flash');
      setTimeout(() => {
        screen.classList.remove('flash');
        state.pomo.finished = false;
        updatePomodoro(true);
      }, 4200);
      refreshPomodoroControls();
    }
    updatePomodoro(true);
  }

  $('#pomoStart').addEventListener('click', () => {
    const p = state.pomo;
    if (!p.active) {
      if (!p.paused || p.remaining <= 0) {
        p.duration = p.minutes * 60000;
        p.remaining = p.duration;
      }
      p.active = true;
      p.paused = false;
      p.finished = false;
      p.endAt = Date.now() + p.remaining;
    } else {
      p.remaining = Math.max(0, p.endAt - Date.now());
      p.active = false;
      p.paused = true;
    }
    refreshPomodoroControls();
    updatePomodoro(true);
  });

  $('#pomoReset').addEventListener('click', () => {
    const p = state.pomo;
    p.active = false;
    p.paused = false;
    p.finished = false;
    p.remaining = 0;
    p.duration = 0;
    screen.classList.remove('flash');
    refreshPomodoroControls();
    updatePomodoro(true);
  });

  $('#pomoMinus').addEventListener('click', () => {
    if (state.pomo.minutes > 1) { state.pomo.minutes--; updatePomodoro(true); }
  });
  $('#pomoPlus').addEventListener('click', () => {
    if (state.pomo.minutes < 60) { state.pomo.minutes++; updatePomodoro(true); }
  });
  $$('.preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.pomo.minutes = Number(btn.dataset.min);
      state.pomo.remaining = 0;
      state.pomo.paused = false;
      updatePomodoro(true);
    });
  });

  // ------------------------------------------------------------------------
  // animations
  // ------------------------------------------------------------------------
  const animCanvas = $('#animCanvas');
  const actx = animCanvas.getContext('2d');
  const ANIM_NAMES = ['MATRIX RAIN', 'STARFIELD 3D', 'BOUNCING DVD'];
  const AW = 464, AH = 279, CX = 232, CY = 139;

  const matrix = [];
  const stars = [];
  let dvd = { x: 100, y: 100, vx: 3, vy: 2, color: '#00a1ff' };

  function initAnimation() {
    state.anim %= ANIM_NAMES.length;
    const pal = state.pal;

    if (state.anim === 0) {
      matrix.length = 0;
      for (let i = 0; i < 38; i++) {
        matrix.push({
          x: 2 + i * 12,
          y: Math.random() * AH,
          speed: 1.4 + Math.random() * 2.2,
          len: 5 + Math.random() * 9,
        });
      }
    } else if (state.anim === 1) {
      stars.length = 0;
      for (let i = 0; i < 90; i++) {
        stars.push({
          x: Math.random() * 2 - 1,
          y: Math.random() * 2 - 1,
          z: 20 + Math.random() * 280,
        });
      }
    } else if (state.anim === 2) {
      dvd = { x: 100, y: 100, vx: 3, vy: 2, color: pal.a1 };
    }

    actx.setTransform(2, 0, 0, 2, 0, 0);
    actx.fillStyle = '#000';
    actx.fillRect(0, 0, AW, AH);
    updateAnimHud(60);
  }

  function drawMatrix() {
    const pal = state.pal;
    actx.fillStyle = 'rgba(0,0,0,0.17)';
    actx.fillRect(0, 0, AW, AH);
    actx.font = '11px ui-monospace, Consolas, monospace';
    actx.textAlign = 'center';

    const glyphs = '0123456789ABCDEFXYZ#*+<>$%&';
    for (const col of matrix) {
      const headY = col.y;
      for (let k = 0; k < col.len; k++) {
        const gy = headY - k * 12;
        if (gy < -12 || gy > AH) continue;
        const ch = glyphs[(Math.random() * glyphs.length) | 0];
        if (k === 0) {
          actx.fillStyle = pal.white;
        } else {
          actx.globalAlpha = Math.max(0.08, 1 - k / col.len);
          actx.fillStyle = pal.a3;
        }
        actx.fillText(ch, col.x, gy);
      }
      actx.globalAlpha = 1;
      col.y += col.speed;
      if (col.y - col.len * 12 > AH) {
        col.y = -Math.random() * 60;
        col.speed = 1.4 + Math.random() * 2.2;
        col.len = 5 + Math.random() * 9;
      }
    }
    actx.textAlign = 'left';
  }

  function drawStars() {
    const pal = state.pal;
    actx.fillStyle = 'rgba(0,0,0,0.32)';
    actx.fillRect(0, 0, AW, AH);
    for (const s of stars) {
      const px = CX + (s.x / s.z) * 420;
      const py = CY + (s.y / s.z) * 420;
      if (px > 0 && px < AW && py > 0 && py < AH) {
        const size = clamp((1 - s.z / 300) * 2.4, 0.6, 2.6);
        actx.fillStyle = s.z < 90 ? pal.white : s.z < 190 ? pal.a1 : pal.dark;
        actx.fillRect(px, py, size, size);
      }
      s.z -= 4.2;
      if (s.z <= 6) {
        s.x = Math.random() * 2 - 1;
        s.y = Math.random() * 2 - 1;
        s.z = 300;
      }
    }
  }

  function drawDvd() {
    const pal = state.pal;
    actx.fillStyle = '#000';
    actx.fillRect(0, 0, AW, AH);
    const w = 70, h = 32;
    dvd.x += dvd.vx;
    dvd.y += dvd.vy;
    let hit = false;
    if (dvd.x <= 6 || dvd.x + w >= AW - 6) { dvd.vx = -dvd.vx; hit = true; }
    if (dvd.y <= 6 || dvd.y + h >= AH - 6) { dvd.vy = -dvd.vy; hit = true; }
    if (hit) {
      const colors = [pal.a1, pal.a2, pal.a3, pal.gold, pal.cool, pal.warm];
      dvd.color = colors[(Math.random() * colors.length) | 0];
    }

    actx.save();
    actx.shadowColor = dvd.color;
    actx.shadowBlur = 12;
    actx.fillStyle = dvd.color;
    actx.beginPath();
    actx.roundRect(dvd.x, dvd.y, w, h, 6);
    actx.fill();
    actx.restore();

    actx.fillStyle = '#000';
    actx.font = 'bold 14px ui-monospace, Consolas, monospace';
    actx.textAlign = 'center';
    actx.textBaseline = 'middle';
    actx.fillText('CYD 3.5', dvd.x + w / 2, dvd.y + h / 2 + 1);
    actx.textAlign = 'left';
    actx.textBaseline = 'alphabetic';
  }

  let frames = 0, fpsWindow = performance.now(), fps = 60;

  function updateAnimHud(fpsVal) {
    $('#animHud').textContent =
      `MODE: ${ANIM_NAMES[state.anim]} | FPS: ${fmt(fpsVal)} | TAP SCREEN TO SWITCH ANIMATION`;
  }

  function animLoop(now) {
    if (state.page === 2) {
      if (state.anim === 0) drawMatrix();
      else if (state.anim === 1) drawStars();
      else if (state.anim === 2) drawDvd();

      frames++;
      if (now - fpsWindow >= 1000) {
        fps = (frames * 1000) / (now - fpsWindow);
        frames = 0;
        fpsWindow = now;
        updateAnimHud(fps);
      }
    }
    requestAnimationFrame(animLoop);
  }
  requestAnimationFrame(animLoop);

  $('#animStage').addEventListener('click', () => {
    state.anim = (state.anim + 1) % ANIM_NAMES.length;
    initAnimation();
  });

  // ------------------------------------------------------------------------
  // settings: saved networks + scrollable theme gallery
  // ------------------------------------------------------------------------
  const settingsViewport = $('#settingsViewport');
  const cardsHost = $('#themeCards');
  const networkGrid = $('#networkGrid');
  const MAX_SCROLL = 382;
  const SCROLL_TRACK_H = 208;
  const SCROLL_THUMB_H = 73;
  const cardRefs = [];
  let drag = { active: false, moved: false, startY: 0, startScroll: 0 };
  let networkPressTimer = null;

  function setSettingsTab(tab) {
    state.settingsTab = tab;
    $$('.settings-tab').forEach((b) => {
      const on = Number(b.dataset.settingsTab) === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    $$('.settings-panel').forEach((p) => {
      p.hidden = Number(p.dataset.settingsPanel) !== tab;
    });
    $('#settingsHint').innerHTML = tab === 0
      ? 'TAP A NETWORK TO CONNECT&nbsp;&nbsp;|&nbsp;&nbsp;HOLD TO FORGET'
      : 'SWIPE UP/DOWN TO SCROLL&nbsp;&nbsp;|&nbsp;&nbsp;TAP A THEME TO APPLY';
    if (tab === 1) {
      setScroll(state.scroll);
    } else {
      renderNetworks();
    }
  }

  function renderNetworks() {
    clearTimeout(networkPressTimer);
    networkGrid.innerHTML = '';
    if (!state.networks.length) {
      const empty = document.createElement('div');
      empty.className = 'network-empty';
      empty.innerHTML = 'NO SAVED NETWORKS<small>USE ADD / CHANGE NETWORK BELOW</small>';
      networkGrid.appendChild(empty);
      return;
    }

    state.networks.forEach((net, i) => {
      const active = i === state.activeNetwork;
      const card = document.createElement('button');
      card.className = 'network-card' + (active ? ' active' : '');
      card.style.left = (i % 2 === 0 ? 16 : 244) + 'px';
      card.style.top = 82 + Math.floor(i / 2) * 60 + 'px';
      card.style.width = '220px';
      card.style.height = '52px';
      card.setAttribute('aria-label', (active ? 'Connected: ' : 'Connect to ') + net.ssid);
      card.innerHTML = '<span class="ssid"></span><span class="url"></span><i class="dot"></i>';
      card.querySelector('.ssid').textContent = net.ssid;
      card.querySelector('.url').textContent = net.url || 'NO SOURCE URL';

      card.addEventListener('click', () => {
        if (card.dataset.forgotten === '1') return;
        state.activeNetwork = i;
        state.rssi = clamp(state.rssi + Math.round((Math.random() - 0.5) * 8), -72, -44);
        renderNetworks();
        updateMonitor();
        updateWifiHeader();
      });

      card.addEventListener('pointerdown', () => {
        card.dataset.forgotten = '0';
        clearTimeout(networkPressTimer);
        networkPressTimer = setTimeout(() => {
          card.dataset.forgotten = '1';
          const wasActive = i === state.activeNetwork;
          state.networks.splice(i, 1);
          if (wasActive) {
            state.activeNetwork = Math.min(i, state.networks.length - 1);
          } else if (i < state.activeNetwork) {
            state.activeNetwork--;
          }
          if (!state.networks.length) state.activeNetwork = -1;
          renderNetworks();
          updateMonitor();
          updateWifiHeader();
        }, 800);
      });
      const cancelPress = () => clearTimeout(networkPressTimer);
      card.addEventListener('pointerup', cancelPress);
      card.addEventListener('pointerleave', cancelPress);
      card.addEventListener('pointercancel', cancelPress);

      networkGrid.appendChild(card);
    });
  }

  $$('.settings-tab').forEach((b) => {
    b.addEventListener('click', () => setSettingsTab(Number(b.dataset.settingsTab)));
  });

  $('#addNetwork').addEventListener('click', () => {
    if (state.networks.length >= 6) return;
    const presets = [
      { ssid: 'STUDIO-2.4G', url: 'http://192.168.0.224:8085/data.json' },
      { ssid: 'GUEST-WIFI', url: 'http://192.168.1.50:8085/data.json' },
      { ssid: 'LAB-5G', url: 'http://10.0.0.42:8085/data.json' },
    ];
    const next = presets.find((p) => !state.networks.some((n) => n.ssid === p.ssid)) || {
      ssid: 'NEW-NETWORK-' + (state.networks.length + 1),
      url: 'http://192.168.0.224:8085/data.json',
    };
    state.networks.push(next);
    state.activeNetwork = state.networks.length - 1;
    renderNetworks();
    updateMonitor();
    updateWifiHeader();
  });

  function themeCardMarkup(t, i) {
    const v = PALETTES[i].vars;
    const selected = i === state.theme;
    const swatches = VAR_NAMES.map((n) => `<i style="background:${v[n]};border-color:${v.border}"></i>`).join('');
    return `
      <div class="name" style="color:${selected ? state.pal.gold : v.white}">${t.name}</div>
      <div class="swatches">${swatches}</div>
      <div class="strip" style="background:${v.header};border-color:${v.border};color:${v.muted}">BG CARD TXT STATUS ACC</div>`;
  }

  function renderThemeCards() {
    cardsHost.innerHTML = '';
    cardRefs.length = 0;
    THEMES.forEach((t, i) => {
      const card = document.createElement('div');
      card.className = 'theme-card' + (i === state.theme ? ' selected' : '');
      card.dataset.theme = String(i);
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', 'Apply ' + t.name + ' theme');
      card.setAttribute('aria-pressed', String(i === state.theme));
      const v = PALETTES[i].vars;
      card.style.background = v.card;
      card.style.borderColor = v.border;
      card.innerHTML = themeCardMarkup(t, i);
      card.style.left = (i % 2 === 0 ? 7 : 235) + 'px';
      card.style.top = 2 + Math.floor(i / 2) * 74 + 'px';

      card.addEventListener('click', (e) => {
        e.stopPropagation();
        if (drag.moved) return;
        applyTheme(i);
        setScroll(state.scroll);
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          applyTheme(i);
          setScroll(state.scroll);
        }
      });

      cardsHost.appendChild(card);
      cardRefs.push(card);
    });
    setScroll(state.scroll);
  }

  function setScroll(next) {
    state.scroll = clamp(next, 0, MAX_SCROLL);
    cardRefs.forEach((card, i) => {
      card.style.top = 2 + Math.floor(i / 2) * 74 - state.scroll + 'px';
    });
    $('#scrollThumb').style.height = SCROLL_THUMB_H + 'px';
    $('#scrollThumb').style.top =
      (state.scroll / MAX_SCROLL) * (SCROLL_TRACK_H - SCROLL_THUMB_H) + 'px';
  }

  settingsViewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    setScroll(state.scroll + e.deltaY * 0.55);
  }, { passive: false });

  settingsViewport.addEventListener('pointerdown', (e) => {
    if (state.settingsTab !== 1) return;
    drag.active = true;
    drag.moved = false;
    drag.startY = e.clientY;
    drag.startScroll = state.scroll;
    settingsViewport.classList.add('dragging');
  });

  settingsViewport.addEventListener('pointermove', (e) => {
    if (!drag.active) return;
    const dy = (e.clientY - drag.startY) / (state.scale || 1);
    if (Math.abs(dy) > 4) drag.moved = true;
    setScroll(drag.startScroll - dy);
  });

  function endDrag() {
    if (!drag.active) return;
    drag.active = false;
    settingsViewport.classList.remove('dragging');
    setTimeout(() => { drag.moved = false; }, 0);
  }
  settingsViewport.addEventListener('pointerup', endDrag);
  settingsViewport.addEventListener('pointercancel', endDrag);

  // ------------------------------------------------------------------------
  // external controls (quick page + theme selectors)
  // ------------------------------------------------------------------------
  const strip = $('#themeStrip');
  THEMES.forEach((t, i) => {
    const v = PALETTES[i].vars;
    const b = document.createElement('button');
    b.className = 'theme-dot';
    b.dataset.theme = String(i);
    b.title = t.name;
    b.setAttribute('aria-label', 'Theme: ' + t.name);
    b.setAttribute('aria-pressed', String(i === state.theme));
    b.style.background = `linear-gradient(135deg, ${v.bg} 0 32%, ${v.a1} 32% 64%, ${v.a2} 64%)`;
    b.addEventListener('click', () => applyTheme(i));
    strip.appendChild(b);
  });

  // ------------------------------------------------------------------------
  // boot
  // ------------------------------------------------------------------------
  applyTheme(0);
  updateMonitor();
  updateWifiPanel(true);
  updateClock(true);
  updatePomodoro(true);
  setPage(0);
  setMonitorSub(0);
  setClockSub(0);
  setSettingsTab(0);

  setInterval(stepTelemetry, 1100);
  setInterval(() => {
    state.rssi = clamp(state.rssi + Math.round((Math.random() - 0.5) * 3), -80, -42);
    updateWifiHeader();
    updateClock(false);
  }, 1000);
  setInterval(tickPomodoro, 200);
  setTimeout(fitScreen, 60);
  window.addEventListener('load', fitScreen);
})();
