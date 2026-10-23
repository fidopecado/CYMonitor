/* ==========================================================================
   CYD Monitor — interactive simulation of src/main.cpp
   ========================================================================== */
(() => {
  'use strict';

  // ------------------------------------------------------------------------
  // 18 theme palettes, exactly as declared in main.cpp (RGB565)
  // order: bg, cardBg, cardBorder, headerBg, barTrack, textWhite, textMuted,
  //        textDark, tempCool, tempWarm, tempHot, accent1, accent2, accent3,
  //        gold
  // ------------------------------------------------------------------------
  // Palettes live in theme-data.js so app.html and the landing simulator share
  // exactly the same 18 RGB565 themes.
  const { THEMES, VAR_NAMES, PALETTES } = window.CYD_THEMES;

  function visibleOnDark(hex, minLuma = 150) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (luma >= minLuma) return hex;
    const t = Math.min(1, (minLuma - luma) / Math.max(1, 255 - luma));
    const lift = (c) => Math.round(c + (255 - c) * t);
    return `rgb(${lift(r)}, ${lift(g)}, ${lift(b)})`;
  }

  // ------------------------------------------------------------------------
  // site palette — mirrors the CYD theme while keeping text readable
  // ------------------------------------------------------------------------
  function rgbOf(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function hexOf(r, g, b) {
    return '#' + [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
  }
  function mixColor(a, b, t) {
    const ca = rgbOf(a), cb = rgbOf(b);
    return hexOf(ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t);
  }
  function luminance(hex) {
    const [r, g, b] = rgbOf(hex).map((c) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contrastRatio(a, b) {
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  function ensureContrast(fg, bg, min = 4.5) {
    if (contrastRatio(fg, bg) >= min) return fg;
    const target = luminance(bg) > 0.45 ? '#000000' : '#ffffff';
    let lo = 0, hi = 1;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (contrastRatio(mixColor(fg, target, mid), bg) >= min) hi = mid;
      else lo = mid;
    }
    return mixColor(fg, target, hi);
  }
  function rgba(hex, alpha) {
    const [r, g, b] = rgbOf(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function applySiteTheme(vars) {
    if (document.body.classList.contains('app-page')) return;

    const darkBg = luminance(vars.bg) <= 0.45;
    const page = mixColor(vars.bg, darkBg ? '#000000' : '#ffffff', darkBg ? 0.2 : 0.14);
    const isLight = luminance(page) > 0.45;
    const baseInk = isLight ? '#141719' : '#f4f7fb';

    const ink = ensureContrast(baseInk, page, 12);
    const surface = mixColor(page, ink, isLight ? 0.055 : 0.09);
    const surface2 = mixColor(page, ink, isLight ? 0.11 : 0.16);
    const inkSoft = ensureContrast(mixColor(ink, page, 0.24), surface2, 5);
    const inkDim = ensureContrast(mixColor(ink, page, 0.38), surface2, 4.5);
    const line = mixColor(ink, page, 0.66);
    const lineStrong = mixColor(ink, page, 0.46);
    const brutal = ensureContrast(ink, page, 9);
    const brutalShadow = ensureContrast(mixColor(ink, page, isLight ? 0.04 : 0.22), page, 4.5);
    const blue = ensureContrast(vars.a1 || vars.cool, surface2, 4.5);
    const orange = ensureContrast(vars.a2 || vars.gold, surface2, 4.5);
    const a3 = ensureContrast(vars.a3, surface2, 4.5);
    const onAccent = contrastRatio(blue, '#ffffff') >= contrastRatio(blue, '#000000') ? '#ffffff' : '#000000';
    const onAccent2 = contrastRatio(orange, '#ffffff') >= contrastRatio(orange, '#000000') ? '#ffffff' : '#000000';
    const onAccent3 = contrastRatio(a3, '#ffffff') >= contrastRatio(a3, '#000000') ? '#ffffff' : '#000000';
    const eyebrow = ensureContrast(mixColor(blue, ink, 0.35), page, 4.5);
    const codeInk = ensureContrast(mixColor(blue, ink, 0.2), page, 4.5);

    const root = document.documentElement.style;
    root.setProperty('--page', page);
    root.setProperty('--surface', surface);
    root.setProperty('--surface-2', surface2);
    root.setProperty('--ink', ink);
    root.setProperty('--ink-soft', inkSoft);
    root.setProperty('--ink-dim', inkDim);
    root.setProperty('--line', line);
    root.setProperty('--line-strong', lineStrong);
    root.setProperty('--brutal', brutal);
    root.setProperty('--brutal-shadow', brutalShadow);
    root.setProperty('--blue', blue);
    root.setProperty('--orange', orange);
    root.setProperty('--on-accent', onAccent);
    root.setProperty('--on-accent-2', onAccent2);
    root.setProperty('--on-accent-3', onAccent3);
    root.setProperty('--nav-bg', surface);
    root.setProperty('--nav-line', brutal);
    root.setProperty('--glass', surface);
    root.setProperty('--glass-strong', surface2);
    root.setProperty('--selection', rgba(blue, 0.32));
    root.setProperty('--strong-ink', ink);
    root.setProperty('--hover-ink', ink);
    root.setProperty('--chip-ink', ink);
    root.setProperty('--stat-ink', ink);
    root.setProperty('--eyebrow-ink', ink);
    root.setProperty('--ghost-ink', ink);
    root.setProperty('--step-ink', ink);
    root.setProperty('--pin-ink', inkDim);
    root.setProperty('--pin-strong', ink);
    root.setProperty('--spec-ink', ink);
    root.setProperty('--foot-ink', ink);
    root.setProperty('--foot-code', inkSoft);
    root.setProperty('--code-ink', codeInk);
    root.setProperty('--code-bg', rgba(blue, 0.14));
    root.setProperty('--code-border', rgba(blue, 0.35));

    // the landing-page feature icons reference the CYD accent names
    root.setProperty('--a1', blue);
    root.setProperty('--a2', orange);
    root.setProperty('--a3', a3);
    root.setProperty('--cool', ensureContrast(vars.cool, page, 4.5));
    root.setProperty('--warm', ensureContrast(vars.warm, page, 4.5));
    root.setProperty('--hot', ensureContrast(vars.hot, page, 4.5));
    root.setProperty('--gold', ensureContrast(vars.gold, page, 4.5));
    root.colorScheme = isLight ? 'light' : 'dark';

    document.body.classList.toggle('site-theme-light', isLight);
  }

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
    theme: 1,
    anim: 0,
    ping: 0,
    rssi: -52,
    pal: PALETTES[1].vars,
    scale: 1,
    cpu: { name: 'AMD RYZEN 5 5600', temp: 47.2, load: 18.4, power: 65.3, fan: 1180 },
    gpu: { name: 'RX 6700 XT', hasHotspot: true, core: 55.6, hot: 67.2, load: 22.1, vram: 5312 },
    ram: { pct: 38.7, used: 12.4, total: 32 },
    latency: { gw: 4, srv: 14 },
    pomo: { active: false, paused: false, finished: false, minutes: 25, remaining: 0, duration: 0, endAt: 0, sessions: 0 },
    themePage: 0,
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
    applySiteTheme(t.vars);

    $$('.theme-dot').forEach((d) => {
      const on = Number(d.dataset.theme) === index;
      d.classList.toggle('active', on);
      d.setAttribute('aria-pressed', String(on));
    });

    const hud = $('.anim-hud');
    if (hud) {
      const c = visibleOnDark(t.vars.a3, 140);
      hud.style.borderColor = c;
      hud.style.color = c;
    }

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

  const secondsBar = $('#secondsBar');

  function updateClock(force) {
    const d = wibNow();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    $('#clockTime').textContent = `${hh}:${mm}:${ss}`;
    $('#clockDate').textContent =
      `${DAYS[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    secondsBar.style.width = (d.getSeconds() / 59) * 100 + '%';
    if (force) updatePomodoro(true);
  }

  const pomoBlocksHost = $('#pomoBlocks');
  for (let i = 0; i < 24; i++) {
    const block = document.createElement('i');
    block.className = 'pomo-block';
    block.style.animationDelay = (-(i * 0.075)).toFixed(3) + 's';
    pomoBlocksHost.appendChild(block);
  }
  const pomoBlockEls = Array.from(pomoBlocksHost.children);

  function pomoSeconds() {
    const p = state.pomo;
    if (p.finished) return 0;
    if (p.active || p.paused) return Math.ceil(p.remaining / 1000);
    return p.minutes * 60;
  }

  function updatePomodoro(force) {
    const p = state.pomo;
    const secs = pomoSeconds();
    const mm = String(Math.floor(secs / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    const digits = $('#pomoDigits');
    digits.textContent = `${mm}:${ss}`;

    const status = $('#pomoStatus');
    const stateColor = p.finished ? 'var(--hot)' : p.active ? 'var(--a1)' : p.paused ? 'var(--a2)' : 'var(--muted)';
    status.textContent = p.finished ? 'COMPLETE' : p.active ? 'FOCUSING' : p.paused ? 'PAUSED' : 'READY';
    status.style.color = stateColor;
    status.style.background = 'transparent';
    digits.style.color = p.finished ? 'var(--hot)' : p.active ? 'var(--a1)' : p.paused ? 'var(--a2)' : 'var(--white)';

    let pct = p.finished ? 0 : 1;
    if (!p.finished && p.duration > 0 && (p.active || p.paused)) pct = p.remaining / p.duration;
    const activeBlocks = clamp(Math.ceil(pct * 24), 0, 24);
    pomoBlocksHost.classList.toggle('running', p.active && !p.finished);
    pomoBlocksHost.classList.toggle('paused', p.paused && !p.active);
    pomoBlocksHost.classList.toggle('finished', p.finished);
    pomoBlockEls.forEach((block, i) => {
      block.classList.toggle('on', i < activeBlocks);
      block.classList.toggle('lead', i === activeBlocks - 1 && activeBlocks > 0);
    });

    const start = $('#pomoStart');
    start.textContent = p.active ? 'PAUSE' : p.paused ? 'RESUME' : 'START';
    start.style.background = p.active ? 'var(--warm)' : 'var(--cool)';

    const dots = $('#sessionDots');
    dots.innerHTML = '';
    const shown = Math.min(p.sessions, 5);
    for (let i = 0; i < 5; i++) {
      const dot = document.createElement('i');
      if (i < shown) dot.className = 'on';
      dots.appendChild(dot);
    }

    $$('.preset').forEach((btn) => {
      const on = Number(btn.dataset.min) === p.minutes;
      btn.classList.toggle('selected', on);
      btn.style.background = on ? 'var(--a1)' : 'var(--header)';
      btn.style.borderColor = on ? 'var(--a1)' : 'var(--border)';
      btn.style.color = on ? 'var(--bg)' : 'var(--white)';
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
  // Animation coordinates are local to the canvas (the canvas starts at y=32 on
  // the screen). Keep all motion inside the firmware's 42..275 screen band so
  // nothing draws behind the footer HUD.
  const AW = 480, AH = 288;
  const ANIM_TOP = 10, ANIM_BOTTOM = 243;
  const STAR_CX = 240, STAR_CY = 128;
  const MATRIX_TOP = 12, MATRIX_BOTTOM = 246, MATRIX_CELL = 12;

  const matrix = [];
  const stars = [];
  let dvd = { x: 100, y: 10, vx: 1, vy: 1, color: '#00a1ff' };

  function initAnimation() {
    state.anim %= ANIM_NAMES.length;
    const pal = state.pal;

    if (state.anim === 0) {
      matrix.length = 0;
      for (let i = 0; i < 24; i++) {
        matrix.push({
          x: 20 + (i * 428) / 23,
          y: MATRIX_TOP + Math.random() * 136,
          speed: 80 + Math.random() * 80,
          len: 4 + Math.random() * 5,
        });
      }
    } else if (state.anim === 1) {
      stars.length = 0;
      for (let i = 0; i < 50; i++) {
        stars.push({
          x: Math.random() * 400 - 200,
          y: Math.random() * 300 - 150,
          z: 10 + Math.random() * 290,
        });
      }
    } else if (state.anim === 2) {
      dvd = { x: 100, y: 10, vx: 1, vy: 1, color: visibleOnDark(pal.a1, 150) };
    }

    actx.setTransform(2, 0, 0, 2, 0, 0);
    actx.fillStyle = '#000';
    actx.fillRect(0, 0, AW, AH);
    updateAnimHud(60);
  }

  function drawMatrix(dt) {
    const pal = state.pal;
    const accent = visibleOnDark(pal.a3, 150);
    const head = visibleOnDark(pal.white, 220);
    actx.fillStyle = 'rgba(0,0,0,0.17)';
    actx.fillRect(0, 0, AW, AH);
    actx.font = '11px ui-monospace, Consolas, monospace';
    actx.textAlign = 'center';
    actx.textBaseline = 'top';

    const glyphs = '0123456789ABCDEFXYZ#*+<>$%&';
    for (const col of matrix) {
      const headY = col.y;
      for (let k = 0; k < col.len; k++) {
        const gy = headY - k * MATRIX_CELL;
        if (gy < MATRIX_TOP || gy + 11 > MATRIX_BOTTOM) continue;
        const ch = glyphs[(Math.random() * glyphs.length) | 0];
        if (k === 0) {
          actx.fillStyle = head;
        } else {
          actx.globalAlpha = Math.max(0.08, 1 - k / col.len);
          actx.fillStyle = accent;
        }
        actx.fillText(ch, col.x, gy);
      }
      actx.globalAlpha = 1;
      col.y += col.speed * dt;
      if (col.y - col.len * MATRIX_CELL > MATRIX_BOTTOM) {
        col.y = MATRIX_TOP + Math.random() * 30;
        col.speed = 80 + Math.random() * 80;
        col.len = 4 + Math.random() * 5;
      }
    }
    actx.textAlign = 'left';
    actx.textBaseline = 'alphabetic';
  }

  function drawStars(dt) {
    const pal = state.pal;
    const near = visibleOnDark(pal.white, 220);
    const mid = visibleOnDark(pal.a1, 170);
    const far = visibleOnDark(pal.dark, 110);
    actx.fillStyle = '#000';
    actx.fillRect(0, 0, AW, AH);
    for (const s of stars) {
      const px = STAR_CX + (s.x / s.z) * 160;
      const py = STAR_CY + (s.y / s.z) * 160;
      if (px >= 12 && px <= 467 && py >= ANIM_TOP && py <= ANIM_BOTTOM) {
        const size = clamp((1 - s.z / 300) * 2.4, 0.6, 2.6);
        actx.fillStyle = s.z < 100 ? near : s.z < 200 ? mid : far;
        actx.fillRect(px, py, size, size);
      }
      s.z -= 240 * dt;
      if (s.z <= 2) {
        s.x = Math.random() * 400 - 200;
        s.y = Math.random() * 300 - 150;
        s.z = 300;
      }
    }
  }

  function drawDvd(dt) {
    const pal = state.pal;
    actx.fillStyle = '#000';
    actx.fillRect(0, 0, AW, AH);
    const w = 70, h = 32;
    dvd.x += dvd.vx * 180 * dt;
    dvd.y += dvd.vy * 120 * dt;
    let hit = false;
    if (dvd.vx < 0 && dvd.x <= 12) { dvd.x = 12; dvd.vx = 1; hit = true; }
    else if (dvd.vx > 0 && dvd.x + w >= AW - 12) { dvd.x = AW - 12 - w; dvd.vx = -1; hit = true; }
    if (dvd.vy < 0 && dvd.y <= 10) { dvd.y = 10; dvd.vy = 1; hit = true; }
    else if (dvd.vy > 0 && dvd.y + h >= 243) { dvd.y = 243 - h; dvd.vy = -1; hit = true; }
    if (hit) {
      const colors = [pal.a1, pal.a2, pal.a3, pal.gold, pal.cool, pal.warm];
      dvd.color = visibleOnDark(colors[(Math.random() * colors.length) | 0], 150);
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

  let frames = 0, fpsWindow = performance.now(), fps = 60, lastAnimTime = 0;

  function updateAnimHud(fpsVal) {
    $('#animHud').textContent =
      `MODE: ${ANIM_NAMES[state.anim]} | FPS: ${fmt(fpsVal)} | TAP SCREEN TO SWITCH ANIMATION`;
  }

  function animLoop(now) {
    const dt = lastAnimTime ? Math.min((now - lastAnimTime) / 1000, 0.1) : 1 / 60;
    lastAnimTime = now;
    if (state.page === 2) {
      if (state.anim === 0) drawMatrix(dt);
      else if (state.anim === 1) drawStars(dt);
      else if (state.anim === 2) drawDvd(dt);

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
  // settings: saved networks + three-page theme gallery
  // ------------------------------------------------------------------------
  const settingsViewport = $('#settingsViewport');
  const cardsHost = $('#themeCards');
  const networkGrid = $('#networkGrid');
  const THEME_PAGE_SIZE = 6;
  const THEME_PAGES = Math.ceil(THEMES.length / THEME_PAGE_SIZE);
  let lastThemeWheel = 0;
  let drag = { active: false, moved: false, startY: 0 };
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
    if (tab === 0) {
      $('#settingsHint').textContent = 'TAP A NETWORK TO CONNECT  |  HOLD TO FORGET';
      renderNetworks();
    } else {
      state.themePage = 0;
      renderThemeCards();
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

  function updateThemeHint() {
    const action = state.themePage === 0
      ? 'SWIPE UP FOR MORE'
      : state.themePage === THEME_PAGES - 1
        ? 'SWIPE DOWN FOR PREVIOUS'
        : 'SWIPE UP/DOWN FOR MORE';
    $('#settingsHint').textContent =
      `${action}  |  TAP TO APPLY  |  ${state.themePage + 1}/${THEME_PAGES}`;
  }

  function renderThemePageIndicator() {
    const host = $('#themePageIndicator');
    host.innerHTML = '';
    for (let p = 0; p < THEME_PAGES; p++) {
      const seg = document.createElement('i');
      if (p === state.themePage) seg.className = 'on';
      host.appendChild(seg);
    }
  }

  function renderThemeCards() {
    cardsHost.innerHTML = '';
    const first = state.themePage * THEME_PAGE_SIZE;
    const last = Math.min(first + THEME_PAGE_SIZE, THEMES.length);
    for (let i = first; i < last; i++) {
      const t = THEMES[i];
      const slot = i - first;
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
      card.style.left = (slot % 2 === 0 ? 7 : 235) + 'px';
      card.style.top = 2 + Math.floor(slot / 2) * 70 + 'px';

      card.addEventListener('click', (e) => {
        e.stopPropagation();
        if (drag.moved) return;
        applyTheme(i);
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          applyTheme(i);
        }
      });

      cardsHost.appendChild(card);
    }
    renderThemePageIndicator();
    if (state.settingsTab === 1) updateThemeHint();
  }

  function setThemePage(page) {
    state.themePage = clamp(page, 0, THEME_PAGES - 1);
    renderThemeCards();
  }

  settingsViewport.addEventListener('wheel', (e) => {
    if (state.settingsTab !== 1) return;
    e.preventDefault();
    const now = performance.now();
    if (now - lastThemeWheel < 300) return;
    lastThemeWheel = now;
    setThemePage(state.themePage + (e.deltaY > 0 ? 1 : -1));
  }, { passive: false });

  settingsViewport.addEventListener('pointerdown', (e) => {
    if (state.settingsTab !== 1) return;
    drag.active = true;
    drag.moved = false;
    drag.startY = e.clientY;
    settingsViewport.classList.add('dragging');
  });

  settingsViewport.addEventListener('pointermove', (e) => {
    if (!drag.active) return;
    const dy = (e.clientY - drag.startY) / (state.scale || 1);
    if (Math.abs(dy) > 6) drag.moved = true;
  });

  function endDrag(e) {
    if (!drag.active) return;
    drag.active = false;
    settingsViewport.classList.remove('dragging');
    const dy = (e.clientY - drag.startY) / (state.scale || 1);
    if (Math.abs(dy) > 20) setThemePage(state.themePage + (dy < 0 ? 1 : -1));
    setTimeout(() => { drag.moved = false; }, 0);
  }
  settingsViewport.addEventListener('pointerup', endDrag);
  settingsViewport.addEventListener('pointercancel', endDrag);

  // ------------------------------------------------------------------------
  // external controls (quick page + theme selectors)
  // ------------------------------------------------------------------------
  const strip = $('#themeStrip');
  if (strip) {
    THEMES.forEach((t, i) => {
      const v = PALETTES[i].vars;
      const b = document.createElement('button');
      b.className = 'theme-dot';
      b.dataset.theme = String(i);
      b.title = t.name;
      b.setAttribute('aria-label', 'Theme: ' + t.name);
      b.setAttribute('aria-pressed', String(i === state.theme));
      b.style.setProperty('--sw-bg', v.bg);
      b.style.setProperty('--sw-a1', v.a1);
      b.style.setProperty('--sw-a2', v.a2);
      b.addEventListener('click', () => applyTheme(i));
      strip.appendChild(b);
    });
  }

  // ------------------------------------------------------------------------
  // in-page navigation: keep anchors reliable below the sticky header
  // ------------------------------------------------------------------------
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  $$('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const hash = a.getAttribute('href');
      if (!hash || hash === '#') return;
      const target = $(hash);
      if (!target) return;
      e.preventDefault();
      const behavior = reduceMotion.matches ? 'auto' : 'smooth';
      if (hash === '#top') window.scrollTo({ top: 0, behavior });
      else target.scrollIntoView({ behavior, block: 'start' });
      history.pushState(null, '', hash);
    });
  });

  // ------------------------------------------------------------------------
  // boot
  // ------------------------------------------------------------------------
  applyTheme(1);
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
