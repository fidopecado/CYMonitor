/* ==========================================================================
   CYD Monitor Web — live runtime
   Fetches LibreHardwareMonitor data.json, scans it like src/main.cpp, and
   drives the responsive dashboard in app.html. Demo telemetry is generated
   locally and always labelled.
   ========================================================================== */
(() => {
  'use strict';

  const { PALETTES, VAR_NAMES, visibleOnDark } = window.CYD_THEMES;
  const STORAGE_KEY = 'cyd.web.config.v2';
  const HISTORY_LEN = 40;
  const FETCH_TIMEOUT = 10000;
  const ALLOWED_INTERVALS = [1000, 2000, 3000, 5000, 10000, 30000];
  const PAGES = ['monitor', 'clock', 'animation', 'settings'];
  const SETTINGS_TABS = ['source', 'themes', 'style'];
  const ANIM_NAMES = ['MATRIX RAIN', 'STARFIELD 3D', 'BOUNCING DVD'];

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const fmt = (n, digits = 1) => Number.isFinite(Number(n)) ? Number(n).toFixed(digits) : '--';

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  // ------------------------------------------------------------------------
  // Colour helpers (the raw firmware palettes are often too low-contrast for
  // a large browser surface, so text and accents are lifted where necessary)
  // ------------------------------------------------------------------------
  function rgbOf(hex) {
    const n = parseInt(String(hex).replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function hexOf(r, g, b) {
    return '#' + [r, g, b].map((n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0')).join('');
  }

  function mixColor(a, b, t) {
    const ca = rgbOf(a);
    const cb = rgbOf(b);
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
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  function ensureContrast(fg, bg, min = 4.5) {
    if (contrastRatio(fg, bg) >= min) return fg;
    const target = luminance(bg) > 0.45 ? '#000000' : '#ffffff';
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 20; i++) {
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

  // ------------------------------------------------------------------------
  // Local configuration. No Wi-Fi data or passwords are ever stored.
  // ------------------------------------------------------------------------
  function readConfig() {
    let parsed = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) parsed = JSON.parse(raw);
    } catch (err) {
      parsed = null;
    }

    const url = parsed && typeof parsed.activeUrl === 'string' ? parsed.activeUrl : '';
    let mode = 'demo';
    if (parsed && parsed.mode === 'live') mode = 'live';
    else if (parsed && parsed.mode === 'demo') mode = 'demo';
    else if (url) mode = 'live';

    const sources = Array.isArray(parsed && parsed.sources)
      ? parsed.sources
          .filter((s) => s && typeof s.url === 'string')
          .slice(0, 6)
          .map((s) => ({
            url: s.url,
            lastConnected: Number(s.lastConnected) || 0,
            sensorCount: Number(s.sensorCount) || 0,
            lhmVersion: typeof s.lhmVersion === 'string' ? s.lhmVersion : '',
          }))
      : [];

    const theme = Number.isInteger(parsed && parsed.theme)
      ? clamp(parsed.theme, 0, PALETTES.length - 1)
      : 1;

    const interval = parsed && ALLOWED_INTERVALS.includes(Number(parsed.interval))
      ? Number(parsed.interval)
      : 3000;

    const style = parsed && parsed.style === 'brutalist' ? 'brutalist' : 'cyd';

    return {
      hasStored: !!parsed,
      config: {
        mode: mode === 'live' && url ? 'live' : (mode === 'demo' ? 'demo' : 'demo'),
        activeUrl: url,
        sources,
        theme,
        interval,
        style,
      },
    };
  }

  let persistenceEnabled = false;

  function saveConfig() {
    if (!persistenceEnabled) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch (err) {
      // Private browsing or a full quota should not break the dashboard.
    }
  }

  const loaded = readConfig();
  const config = loaded.config;

  // ------------------------------------------------------------------------
  // Telemetry shapes
  // ------------------------------------------------------------------------
  function emptyTelemetry() {
    return {
      valid: false,
      cpu: {
        name: 'Waiting for telemetry',
        temp: 0,
        load: 0,
        power: 0,
        fan: 0,
        hasTemp: false,
        hasLoad: false,
        hasPower: false,
        hasFan: false,
      },
      gpu: {
        name: 'Waiting for telemetry',
        temp: 0,
        hot: 0,
        load: 0,
        vramUsed: 0,
        vramTotal: 0,
        hasTemp: false,
        hasHot: false,
        hasLoad: false,
        hasMem: false,
      },
      ram: {
        pct: 0,
        load: 0,
        used: 0,
        total: 0,
        available: 0,
        valid: false,
      },
    };
  }

  function makeDemoTelemetry() {
    return {
      valid: true,
      cpu: {
        name: 'AMD Ryzen 5 5600',
        temp: 47.2,
        load: 18.4,
        power: 65.3,
        fan: 1180,
        hasTemp: true,
        hasLoad: true,
        hasPower: true,
        hasFan: true,
      },
      gpu: {
        name: 'RX 6700 XT',
        temp: 55.6,
        hot: 67.2,
        load: 22.1,
        vramUsed: 5312,
        vramTotal: 12288,
        hasTemp: true,
        hasHot: true,
        hasLoad: true,
        hasMem: true,
      },
      ram: {
        pct: 38.7,
        load: 38.7,
        used: 12.4,
        total: 32,
        available: 19.6,
        valid: true,
      },
    };
  }

  const state = {
    mode: config.mode,
    configured: loaded.hasStored,
    theme: config.theme,
    style: config.style,
    page: 'monitor',
    monitorView: 'hardware',
    clockView: 'clock',
    settingsTab: 'source',
    themePage: Math.floor(config.theme / 6),
    themePageSize: 6,
    telemetry: emptyTelemetry(),
    demoData: makeDemoTelemetry(),
    lastSuccess: 0,
    lastError: '',
    latency: null,
    httpStatus: null,
    contentType: '',
    sensorCount: null,
    lhmVersion: '',
    fetching: false,
    inFlight: null,
    fetchToken: 0,
    history: {
      cpu: Array(HISTORY_LEN).fill(null),
      gpu: Array(HISTORY_LEN).fill(null),
    },
    historyMeta: { cpu: 'temp', gpu: 'temp' },
    requestLog: [],
    animMode: 0,
    pomo: {
      active: false,
      paused: false,
      finished: false,
      minutes: 25,
      remaining: 0,
      duration: 0,
      endAt: 0,
      sessions: 0,
    },
    setupAttempt: 0,
    fetchTimer: 0,
  };

  if (state.mode === 'demo') state.telemetry = state.demoData;

  // ------------------------------------------------------------------------
  // Firmware-compatible sensor scanner
  // ------------------------------------------------------------------------
  function icontains(haystack, needle) {
    if (haystack == null || needle == null || needle === '') return false;
    return String(haystack).toLowerCase().includes(String(needle).toLowerCase());
  }

  function parseSensorValue(text) {
    const s = String(text == null ? '' : text);
    const match = s.match(/[-+]?\d+(?:[.,]\d+)?/);
    return match ? parseFloat(match[0].replace(',', '.')) : 0;
  }

  function sensorValue(node) {
    if (!node) return 0;
    if (typeof node.Value === 'number' && Number.isFinite(node.Value)) return node.Value;
    if (typeof node.Value === 'string') return parseSensorValue(node.Value);
    if (typeof node.RawValue === 'number' && Number.isFinite(node.RawValue)) return node.RawValue;
    return 0;
  }

  function stripSuffix(value, suffix) {
    const pos = value.indexOf(suffix);
    return pos > 0 ? value.slice(0, pos) : value;
  }

  function shortCpuName(raw) {
    let name = String(raw || 'CPU').replace(/\(R\)/gi, '').replace(/\(TM\)/gi, '').trim();
    const suffixes = [
      ' with Radeon Graphics',
      ' with Radeon Vega Graphics',
      ' 64-Core Processor',
      ' 32-Core Processor',
      ' 24-Core Processor',
      ' 16-Core Processor',
      ' 12-Core Processor',
      ' 10-Core Processor',
      ' 8-Core Processor',
      ' 6-Core Processor',
      ' 4-Core Processor',
      ' 2-Core Processor',
      ' Processor',
      ' CPU',
    ];
    suffixes.forEach((suffix) => { name = stripSuffix(name, suffix); });
    name = name.trim();
    return name || 'CPU';
  }

  function shortGpuName(raw) {
    let name = String(raw || 'GPU').replace(/\(R\)/gi, '').replace(/\(TM\)/gi, '').trim();
    if (name.startsWith('AMD Radeon RX ')) {
      name = 'RX ' + name.substring(14);
    } else if (name.startsWith('AMD Radeon ')) {
      const rest = name.substring(11);
      name = rest === 'Graphics' ? 'Radeon Graphics' : rest;
    } else if (name.startsWith('AMD ')) {
      name = name.substring(4);
    } else if (name.startsWith('NVIDIA GeForce ')) {
      name = name.substring(15);
    } else if (name.startsWith('NVIDIA ')) {
      name = name.substring(7);
    } else if (name.startsWith('Intel ')) {
      name = name.substring(6);
    }
    name = name.trim();
    return name || 'GPU';
  }

  function classifyHardware(id) {
    if (typeof id !== 'string') return 'other';
    if (id.startsWith('/amdcpu') || id.startsWith('/intelcpu') || id.startsWith('/cpu')) return 'cpu';
    if (id.startsWith('/gpu')) return 'gpu';
    if (id.startsWith('/ram')) return 'ram';
    return 'other';
  }

  function gpuCandidateScore(gpu) {
    let score = 0;
    if (gpu.hasTemp) score += 100;
    if (gpu.hasHot) score += 40;
    if (gpu.hasLoad) score += 10;
    if (gpu.hasMem) score += 5;
    if (icontains(gpu.name, 'rtx') || icontains(gpu.name, 'gtx') ||
        icontains(gpu.name, 'rx ') || icontains(gpu.name, 'arc ')) score += 30;
    return score;
  }

  function scanSensorNode(node, kind, gpuIdx, scan) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;

    if (typeof node.HardwareId === 'string') {
      kind = classifyHardware(node.HardwareId);
      const hwText = typeof node.Text === 'string' ? node.Text : '';
      if (kind === 'cpu') {
        scan.data.cpu.name = shortCpuName(hwText);
      } else if (kind === 'gpu') {
        if (scan.gpuCount < 3) {
          gpuIdx = scan.gpuCount++;
          scan.gpus[gpuIdx] = {
            name: shortGpuName(hwText),
            temp: 0, hot: 0, load: 0, memUsed: 0, memTotal: 0,
            hasTemp: false, hasHot: false, hasLoad: false, hasMem: false, hasMemTotal: false,
            tempScore: 0, hotScore: 0, loadScore: 0, memScore: 0, memTotalScore: 0,
          };
        } else {
          gpuIdx = -1;
        }
      }
    }

    if (typeof node.SensorId === 'string' && node.SensorId) {
      scan.sensorCount++;
      const type = typeof node.Type === 'string' ? node.Type : '';
      const text = typeof node.Text === 'string' ? node.Text : '';
      const value = sensorValue(node);

      if (kind === 'cpu') {
        if (type === 'Temperature') {
          let score = 10;
          if (icontains(text, 'tctl') || icontains(text, 'tdie')) score = 100;
          else if (icontains(text, 'package')) score = 90;
          else if (icontains(text, 'cpu')) score = 50;
          if (!scan.data.cpu.hasTemp || score > scan.cpuTempScore) {
            scan.data.cpu.temp = value;
            scan.data.cpu.hasTemp = true;
            scan.cpuTempScore = score;
          }
        } else if (type === 'Load') {
          const score = icontains(text, 'total') ? 100 : 10;
          if (score > scan.cpuLoadScore) {
            scan.data.cpu.load = value;
            scan.cpuLoadScore = score;
          }
        } else if (type === 'Power') {
          const score = icontains(text, 'package') ? 100 : (icontains(text, 'cpu') ? 50 : 10);
          if (score > scan.cpuPowerScore) {
            scan.data.cpu.power = value;
            scan.cpuPowerScore = score;
          }
        }
      } else if (kind === 'gpu' && gpuIdx >= 0 && gpuIdx < scan.gpuCount) {
        const gpu = scan.gpus[gpuIdx];
        if (type === 'Temperature') {
          if (icontains(text, 'hot spot') || icontains(text, 'hotspot') || icontains(text, 'junction')) {
            const score = 100;
            if (!gpu.hasHot || score > gpu.hotScore) {
              gpu.hot = value;
              gpu.hasHot = true;
              gpu.hotScore = score;
            }
          } else {
            let score = 10;
            if (icontains(text, 'gpu core')) score = 100;
            else if (icontains(text, 'core')) score = 80;
            else if (icontains(text, 'edge')) score = 70;
            else if (icontains(text, 'gpu')) score = 60;
            if (!gpu.hasTemp || score > gpu.tempScore) {
              gpu.temp = value;
              gpu.hasTemp = true;
              gpu.tempScore = score;
            }
          }
        } else if (type === 'Load') {
          let score = 10;
          if (icontains(text, 'gpu core')) score = 100;
          else if (icontains(text, 'd3d 3d')) score = 80;
          else if (icontains(text, 'core')) score = 60;
          if (!gpu.hasLoad || score > gpu.loadScore) {
            gpu.load = value;
            gpu.hasLoad = true;
            gpu.loadScore = score;
          }
        } else if (type === 'SmallData' || type === 'Data') {
          const used = icontains(text, 'used');
          const total = icontains(text, 'total');
          if (used || total) {
            let score = 10;
            if (icontains(text, 'gpu memory')) score = 100;
            else if (icontains(text, 'd3d') && icontains(text, 'dedicated')) score = 90;
            else if (icontains(text, 'memory')) score = 50;
            if (used && (!gpu.hasMem || score > gpu.memScore)) {
              gpu.memUsed = value;
              gpu.hasMem = true;
              gpu.memScore = score;
            } else if (total && (!gpu.hasMemTotal || score > gpu.memTotalScore)) {
              gpu.memTotal = value;
              gpu.hasMemTotal = true;
              gpu.memTotalScore = score;
            }
          }
        }
      } else if (kind === 'ram') {
        if (icontains(text, 'virtual')) {
          // LHM exposes virtual memory after physical memory; skip it.
        } else if (type === 'Load') {
          scan.data.ram.load = value;
        } else if (type === 'Data') {
          if (icontains(text, 'used')) scan.data.ram.used = value;
          else if (icontains(text, 'available') || icontains(text, 'free')) scan.ramAvailable = value;
        }
      }

      // Fans normally hang off the Super I/O chip, not the CPU node.
      if (type === 'Fan') {
        const score = icontains(text, 'cpu') ? 100 : (icontains(text, 'fan') ? 20 : 10);
        if (score > scan.cpuFanScore) {
          scan.data.cpu.fan = Math.round(value);
          scan.cpuFanScore = score;
        }
      }
    }

    if (Array.isArray(node.Children)) {
      node.Children.forEach((child) => scanSensorNode(child, kind, gpuIdx, scan));
    }
  }

  function scanLhm(root) {
    const scan = {
      data: emptyTelemetry(),
      gpus: [],
      gpuCount: 0,
      cpuTempScore: 0,
      cpuLoadScore: 0,
      cpuPowerScore: 0,
      cpuFanScore: 0,
      ramAvailable: 0,
      sensorCount: 0,
    };
    scan.data.cpu.name = 'CPU';
    scan.data.gpu.name = 'GPU';

    scanSensorNode(root, 'other', -1, scan);

    const data = scan.data;
    if (data.ram.used > 0 && scan.ramAvailable > 0) {
      data.ram.available = scan.ramAvailable;
      data.ram.total = data.ram.used + scan.ramAvailable;
      data.ram.valid = true;
      data.ram.pct = data.ram.load > 0 ? data.ram.load : (data.ram.used / data.ram.total) * 100;
    }
    data.cpu.hasLoad = scan.cpuLoadScore > 0;
    data.cpu.hasPower = scan.cpuPowerScore > 0;
    data.cpu.hasFan = scan.cpuFanScore > 0;

    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < scan.gpuCount; i++) {
      const score = gpuCandidateScore(scan.gpus[i]);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }

    if (best >= 0) {
      const gpu = scan.gpus[best];
      data.gpu.name = gpu.name;
      data.gpu.temp = gpu.temp;
      data.gpu.hot = gpu.hot;
      data.gpu.load = gpu.load;
      data.gpu.vramUsed = gpu.memUsed;
      data.gpu.vramTotal = gpu.memTotal;
      data.gpu.hasTemp = gpu.hasTemp && gpu.temp > 0;
      data.gpu.hasHot = gpu.hasHot && gpu.hot > 0;
      data.gpu.hasLoad = gpu.hasLoad;
      data.gpu.hasMem = gpu.hasMem && gpu.memUsed > 0;
    }

    const gpuHasData = best >= 0 && (scan.gpus[best].hasTemp || scan.gpus[best].hasLoad || scan.gpus[best].hasMem);
    data.valid = data.cpu.hasTemp || scan.cpuLoadScore > 0 || scan.cpuPowerScore > 0 ||
      scan.cpuFanScore > 0 || data.ram.valid || gpuHasData;

    return { data, sensorCount: scan.sensorCount, gpuCount: scan.gpuCount };
  }

  // ------------------------------------------------------------------------
  // Fetch helpers
  // ------------------------------------------------------------------------
  function sourceError(message, kind, extra) {
    const err = new Error(message);
    err.kind = kind;
    if (extra) Object.assign(err, extra);
    return err;
  }

  async function fetchJson(url, timeout = FETCH_TIMEOUT) {
    const started = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let response;

    try {
      response = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'follow',
        signal: controller.signal,
        headers: { Accept: 'application/json, text/plain, */*' },
      });
    } catch (err) {
      clearTimeout(timer);
      const latency = Math.round(performance.now() - started);
      if (err && err.name === 'AbortError') {
        throw sourceError('The request timed out after 10 seconds.', 'timeout', { latency });
      }
      if (err && typeof err === 'object') err.latency = latency;
      throw err;
    }

    let text = '';
    try {
      text = await response.text();
    } catch (err) {
      clearTimeout(timer);
      const latency = Math.round(performance.now() - started);
      throw sourceError('The response body could not be read.', 'body', { latency, status: response.status });
    }
    clearTimeout(timer);

    const latency = Math.round(performance.now() - started);
    const contentType = response.headers.get('content-type') || '';

    if (!response.ok) {
      throw sourceError(
        `HTTP ${response.status}${response.statusText ? ' ' + response.statusText : ''}`,
        'http',
        { status: response.status, statusText: response.statusText, latency, contentType, body: text.slice(0, 300) }
      );
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch (err) {
      throw sourceError('The endpoint replied, but the body is not valid JSON.', 'json', {
        status: response.status,
        latency,
        contentType,
        body: text.slice(0, 300),
      });
    }

    return { json, response, latency, contentType, textLength: text.length };
  }

  function endpointHost(url) {
    try {
      return new URL(url).host;
    } catch (err) {
      return url || 'unknown host';
    }
  }

  function isMixedContent(url) {
    return location.protocol === 'https:' && /^http:\/\//i.test(url);
  }

  function explainError(err, url = config.activeUrl) {
    if (isMixedContent(url)) {
      return 'Mixed content blocked: an HTTPS page cannot fetch an HTTP LibreHardwareMonitor endpoint. Open the app over HTTP (localhost/Docker) or use an HTTPS proxy.';
    }
    if (err && err.kind === 'http') {
      return `The endpoint returned HTTP ${err.status || 'error'}. Check the LibreHardwareMonitor Remote Web Server and the URL path (${url || 'no URL'}).`;
    }
    if (err && err.kind === 'json') {
      return 'The endpoint returned HTML or another non-JSON response. Make sure the URL ends with /data.json and points to LibreHardwareMonitor.';
    }
    if (err && err.kind === 'sensors') {
      return err.message;
    }
    if (err && (err.kind === 'timeout' || err.name === 'AbortError')) {
      return 'The request timed out after 10 seconds. Check that the PC is awake, LibreHardwareMonitor is running and port 8085 is reachable.';
    }
    if (err instanceof TypeError) {
      if (location.protocol === 'file:') {
        return 'This page is opened from a file. Serve the web app over HTTP (for example python -m http.server) so the browser can fetch LibreHardwareMonitor.';
      }
      return 'Could not reach the endpoint. Check the URL, Windows Firewall and that LHM Remote Web Server is running. If the JSON opens in a new tab, the page is probably blocked by CORS.';
    }
    return (err && err.message) || 'Unknown source error.';
  }

  // ------------------------------------------------------------------------
  // Theme application
  // ------------------------------------------------------------------------
  function applyTheme(index) {
    const i = clamp(Number(index) || 0, 0, PALETTES.length - 1);
    const palette = PALETTES[i];
    const p = palette.vars;
    const dark = luminance(p.bg) < 0.43;
    const surface = p.card;
    const ink = ensureContrast(p.white, surface, 7);
    const muted = ensureContrast(p.muted, surface, 4.5);
    const line = ensureContrast(p.border, surface, 2.6);
    const lineStrong = ensureContrast(p.border, surface, 4.5);
    const accent = ensureContrast(p.a1, surface, 4.5);
    const accent2 = ensureContrast(p.a2, surface, 4.5);
    const accent3 = ensureContrast(p.a3, surface, 4.5);
    const gold = ensureContrast(p.gold, surface, 4.5);
    const cool = ensureContrast(p.cool, surface, 4.5);
    const warm = ensureContrast(p.warm, surface, 4.5);
    const hot = ensureContrast(p.hot, surface, 4.5);
    const surface2 = mixColor(surface, ink, dark ? 0.07 : 0.035);
    const surface3 = mixColor(surface, ink, dark ? 0.16 : 0.10);
    const bgDeep = mixColor(p.bg, dark ? '#000000' : '#ffffff', dark ? 0.22 : 0.10);
    const onAccent = contrastRatio(accent, '#ffffff') >= contrastRatio(accent, '#000000') ? '#ffffff' : '#000000';
    const onAccent2 = contrastRatio(accent2, '#ffffff') >= contrastRatio(accent2, '#000000') ? '#ffffff' : '#000000';
    const onAccent3 = contrastRatio(accent3, '#ffffff') >= contrastRatio(accent3, '#000000') ? '#ffffff' : '#000000';
    const ok = dark ? '#4ade80' : '#15803d';
    const warn = dark ? '#fbbf24' : '#b45309';
    const bad = dark ? '#f87171' : '#b91c1c';

    const root = document.documentElement;
    const vars = {
      '--bg': p.bg,
      '--bg-deep': bgDeep,
      '--surface': surface,
      '--surface-2': surface2,
      '--surface-3': surface3,
      '--ink': ink,
      '--muted': muted,
      '--line': line,
      '--line-strong': lineStrong,
      '--accent': accent,
      '--accent-2': accent2,
      '--accent-3': accent3,
      '--gold': gold,
      '--cool': cool,
      '--warm': warm,
      '--hot': hot,
      '--ok': ok,
      '--warn': warn,
      '--bad': bad,
      '--on-accent': onAccent,
      '--on-accent-2': onAccent2,
      '--on-accent-3': onAccent3,
      '--topbar': rgba(bgDeep, 0.92),
      '--shadow-color': rgba(dark ? '#000000' : ink, dark ? 0.45 : 0.14),
      '--glow-1': rgba(accent, dark ? 0.20 : 0.13),
      '--glow-2': rgba(accent2, dark ? 0.12 : 0.08),
    };
    Object.entries(vars).forEach(([name, value]) => root.style.setProperty(name, value));
    root.style.colorScheme = dark ? 'dark' : 'light';
    root.dataset.theme = String(i);

    const themeColor = $('#themeColor');
    if (themeColor) themeColor.setAttribute('content', p.bg);

    state.theme = i;
    config.theme = i;
    saveConfig();
    markThemeSelection();
    drawAllSparks();
  }

  function applyStyle(value) {
    const style = value === 'brutalist' ? 'brutalist' : 'cyd';
    config.style = style;
    state.style = style;
    document.documentElement.dataset.style = style;

    const toggle = $('#styleBrutalist');
    if (toggle) toggle.checked = style === 'brutalist';
    setText('styleState', style === 'brutalist' ? 'ON' : 'OFF');
  }

  // ------------------------------------------------------------------------
  // History, charts and monitor rendering
  // ------------------------------------------------------------------------
  function pushHistory(arr, value) {
    arr.shift();
    arr.push(Number.isFinite(value) ? value : null);
  }

  function resetHistory() {
    state.history.cpu = Array(HISTORY_LEN).fill(null);
    state.history.gpu = Array(HISTORY_LEN).fill(null);
    state.historyMeta.cpu = 'temp';
    state.historyMeta.gpu = 'temp';
  }

  function seedDemoHistory() {
    state.history.cpu = Array.from({ length: HISTORY_LEN }, (_, i) =>
      45 + Math.sin(i / 4.5) * 4 + Math.random() * 2);
    state.history.gpu = Array.from({ length: HISTORY_LEN }, (_, i) =>
      55 + Math.cos(i / 6) * 5 + Math.random() * 2);
    state.historyMeta.cpu = 'temp';
    state.historyMeta.gpu = 'temp';
  }

  function historyDelta(arr, allowZero = false) {
    let last = null;
    let prev = null;
    for (let i = arr.length - 1; i >= 0; i--) {
      const value = arr[i];
      const usable = Number.isFinite(value) && (allowZero ? value >= 0 : value > 0);
      if (usable) {
        if (last == null) last = value;
        else {
          prev = value;
          break;
        }
      }
    }
    if (last == null || prev == null) return null;
    return last - prev;
  }

  function renderTrend(el, delta) {
    if (!el) return;
    if (delta == null) {
      el.textContent = '—';
      el.className = 'trend';
    } else if (delta > 0.3) {
      el.textContent = `↑ +${fmt(delta)}`;
      el.className = 'trend is-up';
    } else if (delta < -0.3) {
      el.textContent = `↓ ${fmt(delta)}`;
      el.className = 'trend is-down';
    } else {
      el.textContent = '→ STABLE';
      el.className = 'trend';
    }
  }

  function formatAverage(history, unit) {
    const values = history.filter((value) => Number.isFinite(value) && (unit === '%' ? value >= 0 : value > 0));
    if (!values.length) return '--';
    const average = values.reduce((total, value) => total + value, 0) / values.length;
    return unit === '%' ? `AVG ${fmt(average)}%` : `AVG ${fmt(average)}${unit}`;
  }

  function drawSpark(id, history, unit, accentVar) {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const pixelW = Math.round(rect.width * dpr);
    const pixelH = Math.round(rect.height * dpr);
    if (canvas.width !== pixelW) canvas.width = pixelW;
    if (canvas.height !== pixelH) canvas.height = pixelH;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue(accentVar).trim() || '#777777';
    const line = styles.getPropertyValue('--line').trim() || '#999999';
    const muted = styles.getPropertyValue('--muted').trim() || '#777777';
    const w = rect.width;
    const h = rect.height;
    const isPercent = unit === '%';

    const points = [];
    history.forEach((value, index) => {
      if (Number.isFinite(value) && (isPercent ? value >= 0 : value > 0)) {
        points.push({ index, value });
      }
    });

    const axisWidth = Math.max(56, Math.min(72, Math.round(w * 0.1)));
    const pad = {
      left: axisWidth,
      right: 5,
      top: 9,
      bottom: 9,
    };
    const plotW = Math.max(1, w - pad.left - pad.right);
    const plotH = Math.max(1, h - pad.top - pad.bottom);
    const axisFont = Math.max(13, Math.min(17, Math.round(h * 0.13)));

    if (points.length < 2) {
      ctx.fillStyle = muted;
      ctx.font = `700 ${axisFont}px ui-monospace, Consolas, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('COLLECTING SAMPLES...', pad.left + plotW / 2, h / 2);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      return;
    }

    const values = points.map((point) => point.value);
    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);
    let min;
    let max;

    if (isPercent) {
      min = 0;
      max = Math.min(100, Math.max(10, Math.ceil((dataMax + 4) / 10) * 10));
    } else {
      min = Math.floor(dataMin - 2);
      max = Math.ceil(dataMax + 2);
      if (max - min < 4) {
        const middle = (max + min) / 2;
        min = Math.floor(middle - 2);
        max = Math.ceil(middle + 2);
      }
    }
    if (max <= min) max = min + (isPercent ? 10 : 4);

    const xFor = (index) => pad.left + (index / Math.max(1, history.length - 1)) * plotW;
    const yFor = (value) => pad.top + (1 - (value - min) / (max - min)) * plotH;
    const tickLabel = (value) => isPercent ? `${Math.round(value)}%` : `${Math.round(value)}${unit}`;
    const average = values.reduce((total, value) => total + value, 0) / values.length;

    ctx.font = `700 ${axisFont}px ui-monospace, Consolas, monospace`;
    ctx.fillStyle = muted;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(tickLabel(max), pad.left - 6, pad.top);
    ctx.fillText(tickLabel(min), pad.left - 6, h - pad.bottom);

    ctx.strokeStyle = rgba(line, 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left - 1, pad.top);
    ctx.lineTo(pad.left - 1, h - pad.bottom);
    ctx.stroke();

    const averageY = yFor(average);
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = rgba(accent, 0.7);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(pad.left, averageY);
    ctx.lineTo(w - pad.right, averageY);
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    points.forEach((point, index) => {
      const x = xFor(point.index);
      const y = yFor(point.value);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    const last = points[points.length - 1];
    ctx.beginPath();
    ctx.arc(xFor(last.index), yFor(last.value), 2.8, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  function drawAllSparks() {
    const cpuUnit = state.historyMeta.cpu === 'temp' ? '°C' : '%';
    const gpuUnit = state.historyMeta.gpu === 'temp' ? '°C' : '%';
    drawSpark('cpuSpark', state.history.cpu, cpuUnit, '--accent');
    drawSpark('gpuSpark', state.history.gpu, gpuUnit, '--accent-2');
  }

  function usageColor(pct) {
    if (!Number.isFinite(pct)) return 'var(--accent)';
    if (pct >= 85) return 'var(--hot)';
    if (pct >= 60) return 'var(--warm)';
    return 'var(--cool)';
  }

  function formatMemoryMb(value) {
    if (!Number.isFinite(value) || value <= 0) return '—';
    return value >= 1024 ? `${fmt(value / 1024)} GB` : `${Math.round(value)} MB`;
  }

  function formatGb(value) {
    return Number.isFinite(value) && value > 0 ? `${fmt(value)} GB` : '-- GB';
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function renderMonitor() {
    const data = state.telemetry || emptyTelemetry();
    const demo = state.mode === 'demo';
    const liveLabel = demo ? 'Demo · simulated' : 'Live · LibreHardwareMonitor';

    setText('cpuName', data.valid ? (data.cpu.name || 'CPU') : 'Waiting for telemetry');
    setText('cpuMeta', data.valid ? liveLabel : (state.lastError ? 'Source error' : 'No CPU sensor'));
    setText('cpuTemp', data.cpu.hasTemp ? fmt(data.cpu.temp) : '--.-');
    setText('cpuLoad', data.cpu.hasLoad ? `${fmt(data.cpu.load)}%` : '--.-%');
    setText('cpuPower', data.cpu.hasPower && data.cpu.power > 0 ? `${fmt(data.cpu.power, 0)} W` : '-- W');
    setText('cpuFan', data.cpu.hasFan && data.cpu.fan > 0 ? `${Math.round(data.cpu.fan)} RPM` : '-- RPM');
    renderTrend($('#cpuTrend'), historyDelta(state.history.cpu, state.historyMeta.cpu === 'load'));
    const cpuBar = $('#cpuBar');
    if (cpuBar) {
      cpuBar.style.width = `${clamp(data.cpu.load || 0, 0, 100)}%`;
      cpuBar.style.background = usageColor(data.cpu.load || 0);
    }
    setText('cpuRange', formatAverage(state.history.cpu, state.historyMeta.cpu === 'temp' ? '°C' : '%'));

    const gpuPrimary = data.gpu.hasTemp ? data.gpu.temp : (data.gpu.hasLoad ? data.gpu.load : null);
    setText('gpuName', data.valid ? (data.gpu.name || 'GPU') : 'Waiting for telemetry');
    setText('gpuMeta', data.valid ? liveLabel : (state.lastError ? 'Source error' : 'No GPU sensor'));
    setText('gpuTemp', gpuPrimary == null ? '--.-' : fmt(gpuPrimary));
    setText('gpuUnit', data.gpu.hasTemp ? '°C' : (data.gpu.hasLoad ? '%' : '°C'));
    setText('gpuLoad', data.gpu.hasLoad ? `${fmt(data.gpu.load)}%` : '--.-%');
    setText('gpuVram', data.gpu.hasMem ? formatMemoryMb(data.gpu.vramUsed) : '--');
    setText('gpuVramTotal', data.gpu.hasMem ? formatMemoryMb(data.gpu.vramTotal) : '--');
    renderTrend($('#gpuTrend'), historyDelta(state.history.gpu, state.historyMeta.gpu === 'load'));
    const gpuBar = $('#gpuBar');
    if (gpuBar) {
      gpuBar.style.width = `${clamp(data.gpu.load || 0, 0, 100)}%`;
      gpuBar.style.background = usageColor(data.gpu.load || 0);
    }
    setText('gpuRange', formatAverage(state.history.gpu, state.historyMeta.gpu === 'temp' ? '°C' : '%'));

    const hotspot = $('#gpuHot');
    if (hotspot) {
      hotspot.hidden = !data.gpu.hasHot;
      if (data.gpu.hasHot) {
        hotspot.textContent = `HOT ${fmt(data.gpu.hot)}°C`;
        hotspot.classList.toggle('is-hot', data.gpu.hot >= 85);
      }
    }

    setText('ramMeta', data.ram.valid ? liveLabel : (state.lastError ? 'Source error' : 'No memory sensor'));
    setText('ramPct', data.ram.valid ? fmt(data.ram.pct) : '--.-');
    setText('ramUsed', data.ram.valid ? formatGb(data.ram.used) : '-- GB');
    setText('ramTotal', data.ram.valid ? formatGb(data.ram.total) : '-- GB');
    setText('ramFree', data.ram.valid ? `${formatGb(Math.max(0, data.ram.total - data.ram.used))} available` : '-- GB available');
    setText('ramSource', demo ? 'DEMO' : (data.ram.valid ? 'LHM' : '—'));
    renderTrend($('#ramTrend'), null);
    const ramBar = $('#ramBar');
    if (ramBar) {
      ramBar.style.width = `${clamp(data.ram.pct || 0, 0, 100)}%`;
      ramBar.style.background = usageColor(data.ram.pct || 0);
    }

    drawAllSparks();
  }

  // ------------------------------------------------------------------------
  // Status, banners and source metadata
  // ------------------------------------------------------------------------
  function formatRelative(timestamp) {
    if (!timestamp) return '—';
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 2) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m ago`;
  }

  function formatClockTime(timestamp) {
    try {
      return new Date(timestamp).toLocaleTimeString(undefined, {
        hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    } catch (err) {
      return '--:--:--';
    }
  }

  function effectiveStatus() {
    if (state.mode === 'demo') return 'demo';
    if (state.fetching && !state.lastSuccess) return 'connecting';
    if (state.lastError) return state.lastSuccess ? 'stale' : 'error';
    if (!state.lastSuccess) return 'connecting';
    const threshold = Math.max(config.interval * 3, 15000);
    if (Date.now() - state.lastSuccess > threshold) return 'stale';
    return 'live';
  }

  function setBanner(status) {
    const banner = $('#modeBanner');
    const text = $('#bannerText');
    const action = $('#bannerAction');
    const symbol = $('#bannerSymbol');
    if (!banner || !text || !action || !symbol) return;

    if (status === 'live' || status === 'connecting') {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    banner.dataset.state = status;
    text.replaceChildren();

    const title = document.createElement('strong');
    let body = '';
    let actionText = 'Fix source';
    let actionKind = 'source';

    if (status === 'demo') {
      symbol.textContent = 'D';
      title.textContent = 'Demo mode.';
      body = 'These values are generated in your browser, not read from LibreHardwareMonitor.';
      actionText = 'Connect source';
    } else if (status === 'stale') {
      symbol.textContent = '!';
      title.textContent = 'Live data is stale.';
      body = `Last successful update ${formatRelative(state.lastSuccess)}. ${state.lastError || 'Retrying automatically.'}`;
      actionText = 'Retry';
      actionKind = 'retry';
    } else {
      symbol.textContent = '!';
      title.textContent = 'Live source unreachable.';
      body = state.lastError || 'No telemetry received yet.';
      actionText = 'Fix source';
    }

    text.append(title, document.createTextNode(' ' + body));
    action.textContent = actionText;
    action.dataset.action = actionKind;
  }

  function updateSourceMeta(status) {
    const demo = state.mode === 'demo';
    const connected = !!config.activeUrl;
    const endpointText = demo
      ? 'Demo telemetry (generated in this browser)'
      : (connected ? config.activeUrl : 'No source configured');

    setText('sourceEndpoint', endpointText);
    setText('sourceUpdated', demo ? formatRelative(state.lastSuccess) : (state.lastSuccess ? formatRelative(state.lastSuccess) : '—'));
    setText('sourceLatency', demo ? 'Local' : (state.latency == null ? '—' : `${state.latency} ms`));
    setText('sourceSensors', demo ? 'Generated' : (state.sensorCount == null ? '—' : String(state.sensorCount)));
    setText('sourceVersion', demo ? 'DEMO' : (state.lhmVersion || '—'));

    const note = $('#sourceNote');
    if (note) {
      if (demo) {
        note.textContent = config.activeUrl
          ? `Demo mode is active. The saved source ${config.activeUrl} is not being polled until you connect it.`
          : 'Demo mode is active. Connect a LibreHardwareMonitor data.json URL to replace these generated values with real sensors.';
      } else if (state.lastError) {
        note.textContent = `Last error: ${state.lastError}`;
      } else if (status === 'stale') {
        note.textContent = `No update for ${formatRelative(state.lastSuccess)}. Retrying automatically.`;
      } else {
        note.textContent = 'Values are fetched directly from LibreHardwareMonitor. The endpoint must allow CORS; HTTPS pages cannot fetch HTTP endpoints.';
      }
    }

    const lede = $('#monitorLede');
    if (lede) {
      if (demo) {
        lede.textContent = `Demo telemetry · generated locally · ${formatRelative(state.lastSuccess)}`;
      } else if (status === 'error') {
        lede.textContent = `Live source unreachable · ${state.lastError || 'no telemetry received'}`;
      } else if (status === 'stale') {
        lede.textContent = `Last live data ${formatRelative(state.lastSuccess)} · retrying in the background`;
      } else if (status === 'connecting') {
        lede.textContent = config.activeUrl ? `Connecting to ${endpointHost(config.activeUrl)}…` : 'Waiting for a source.';
      } else {
        lede.textContent = `Live from ${endpointHost(config.activeUrl)} · updated ${formatRelative(state.lastSuccess)}`;
      }
    }

    const badge = $('#sourceBadge');
    const badgeText = $('#sourceBadgeText');
    if (badge && badgeText) {
      const labels = { live: 'LIVE', demo: 'DEMO', connecting: 'SYNC', stale: 'STALE', error: 'ERROR' };
      badge.dataset.state = status;
      badgeText.textContent = labels[status] || '—';
    }
  }

  function renderSourceCards() {
    const host = $('#sourceGrid');
    const empty = $('#sourceEmpty');
    if (!host) return;

    let sources = config.sources.slice(0, 6);
    if (config.activeUrl && !sources.some((source) => source.url === config.activeUrl)) {
      sources = [{ url: config.activeUrl, lastConnected: state.lastSuccess || 0, sensorCount: state.sensorCount }, ...sources];
    }

    if (!sources.length) {
      host.hidden = true;
      host.replaceChildren();
      if (empty) empty.hidden = false;
      return;
    }

    host.hidden = false;
    if (empty) empty.hidden = true;
    host.replaceChildren();

    sources.forEach((source) => {
      const active = state.mode !== 'demo' && source.url === config.activeUrl;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'source-card' + (active ? ' is-active' : '');
      button.dataset.url = source.url;
      button.setAttribute('aria-pressed', String(active));
      button.title = active
        ? `Active source · ${source.url}`
        : `Connect to ${source.url}`;

      const top = document.createElement('span');
      top.className = 'source-card-top';
      const name = document.createElement('span');
      name.className = 'source-card-name';
      name.textContent = endpointHost(source.url);
      const dot = document.createElement('span');
      dot.className = 'source-card-dot';
      dot.setAttribute('aria-hidden', 'true');
      top.append(name, dot);

      const url = document.createElement('span');
      url.className = 'source-card-url';
      url.textContent = source.url;

      const meta = document.createElement('span');
      meta.className = 'source-card-meta';
      if (active) {
        const count = state.sensorCount == null ? 'waiting for sensors' : `${state.sensorCount} sensors`;
        meta.textContent = `ACTIVE · ${count}`;
      } else if (source.lastConnected) {
        const count = source.sensorCount ? ` · ${source.sensorCount} sensors` : '';
        meta.textContent = `LAST USED ${formatRelative(source.lastConnected)}${count}`;
      } else {
        meta.textContent = 'SAVED SOURCE';
      }

      button.append(top, url, meta);
      button.addEventListener('click', () => {
        if (state.mode === 'live' && source.url === config.activeUrl) refreshNow();
        else activateSource(source.url);
      });
      host.appendChild(button);
    });
  }

  function renderSettings() {
    renderSourceCards();
    const note = $('#settingsSourceNote');
    if (note) {
      note.hidden = !state.lastError;
      note.textContent = state.lastError ? `Last error: ${state.lastError}` : '';
    }
    const interval = $('#intervalSelect');
    if (interval && interval.value !== String(config.interval)) interval.value = String(config.interval);
    const current = $('#themeCurrent');
    if (current) current.textContent = PALETTES[state.theme].name;
  }

  function renderStatus() {
    const status = effectiveStatus();
    const pill = $('#statusPill');
    const text = $('#statusText');
    const labels = { live: 'LIVE', demo: 'DEMO', connecting: 'SYNC', stale: 'STALE', error: 'OFFLINE' };
    if (pill) {
      pill.dataset.state = status;
      pill.title = status === 'live'
        ? `Live · ${state.sensorCount == null ? 'unknown' : state.sensorCount} sensors · updated ${formatRelative(state.lastSuccess)}`
        : status === 'demo' ? 'Generated demo telemetry' : `Source status: ${status}`;
    }
    if (text) text.textContent = labels[status] || '—';

    const busy = state.fetching ? 'true' : 'false';
    ['refreshButton', 'refreshButton2'].forEach((id) => {
      const button = document.getElementById(id);
      if (button) button.setAttribute('aria-busy', busy);
    });

    setBanner(status);
    updateSourceMeta(status);
    if (state.lastRenderedStatus !== status) {
      state.lastRenderedStatus = status;
      renderSettings();
    }
  }

  // ------------------------------------------------------------------------
  // Network diagnostics (real browser/fetch facts only)
  // ------------------------------------------------------------------------
  function renderNetwork() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    setText('netOnline', navigator.onLine ? 'Yes' : 'No');
    setText('netEffective', conn && conn.effectiveType ? conn.effectiveType : 'Not exposed');
    setText('netDownlink', conn && Number.isFinite(conn.downlink) ? `${conn.downlink} Mb/s` : 'Not exposed');
    setText('netRtt', conn && Number.isFinite(conn.rtt) ? `${conn.rtt} ms` : 'Not exposed');
    setText('netSaveData', conn && typeof conn.saveData === 'boolean' ? (conn.saveData ? 'On' : 'Off') : 'Not exposed');
    setText('netEndpoint', config.activeUrl || 'No source configured');
    setText('netProtocol', `${location.protocol.replace(':', '').toUpperCase() || 'UNKNOWN'} · ${location.host || 'local file'}`);
    setText('netHttp', state.httpStatus == null ? '—' : String(state.httpStatus));
    setText('netLatency', state.latency == null ? '—' : `${state.latency} ms`);
    setText('netContentType', state.contentType || '—');
    setText('netLastSuccess', state.mode === 'demo' ? 'Demo mode' : (state.lastSuccess ? formatRelative(state.lastSuccess) : '—'));
    setText('netLastError', state.lastError || '—');

    const warning = $('#mixedContentWarning');
    if (warning) warning.hidden = !isMixedContent(config.activeUrl);

    const log = $('#requestLog');
    if (!log) return;
    log.replaceChildren();
    if (!state.requestLog.length) {
      const empty = document.createElement('li');
      empty.className = 'request-empty';
      empty.textContent = 'No live requests yet.';
      log.appendChild(empty);
      return;
    }
    state.requestLog.forEach((entry) => {
      const li = document.createElement('li');
      li.className = entry.ok ? 'is-ok' : 'is-error';
      const time = document.createElement('span');
      time.textContent = formatClockTime(entry.at);
      const result = document.createElement('span');
      result.className = 'request-state';
      result.textContent = entry.ok ? 'OK' : 'ERR';
      const detail = document.createElement('span');
      const pieces = [entry.label || 'fetch'];
      if (entry.latency != null) pieces.push(`${entry.latency}ms`);
      if (entry.http != null) pieces.push(`HTTP ${entry.http}`);
      if (entry.message) pieces.push(entry.message);
      detail.textContent = pieces.join(' · ');
      li.append(time, result, detail);
      log.appendChild(li);
    });
  }

  // ------------------------------------------------------------------------
  // Theme gallery + setup palette
  // ------------------------------------------------------------------------
  function markThemeSelection() {
    $$('.theme-option').forEach((button) => {
      const selected = Number(button.dataset.theme) === state.theme;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    const current = $('#themeCurrent');
    if (current) current.textContent = PALETTES[state.theme].name;
  }

  function themePageLayout() {
    const host = $('#themeGrid');
    if (!host) return { perPage: 6, cols: 2, rows: 3, minHeight: 104 };

    const rect = host.getBoundingClientRect();
    const styles = getComputedStyle(host);
    const gap = parseFloat(styles.rowGap || styles.gap) || 8;
    const viewport = window.innerWidth;
    const small = viewport <= 430;
    const minWidth = small ? 138 : viewport <= 720 ? 150 : 210;
    const minHeight = small ? 96 : viewport <= 720 ? 104 : 118;
    const width = rect.width || host.clientWidth || Math.max(280, viewport - (small ? 28 : 56));
    const height = rect.height || host.clientHeight || Math.max(minHeight * 3 + gap * 2, window.innerHeight * 0.55);

    const maxCols = clamp(Math.floor((width + gap) / (minWidth + gap)), 1, 6);
    const maxRows = clamp(Math.floor((height + gap) / (minHeight + gap)), 1, 4);
    const capacity = Math.max(1, maxCols * maxRows);
    const perPage = [18, 9, 6, 3, 2, 1].find((size) => size <= capacity) || 1;

    let cols = 0;
    for (let candidate = Math.min(maxCols, perPage); candidate >= 1; candidate -= 1) {
      if (perPage % candidate !== 0) continue;
      if (perPage / candidate <= maxRows) {
        cols = candidate;
        break;
      }
    }
    if (!cols) cols = Math.max(1, Math.min(maxCols, perPage));

    return {
      perPage,
      cols,
      rows: Math.max(1, Math.ceil(perPage / cols)),
      minHeight,
    };
  }

  function renderThemeGrid() {
    const host = $('#themeGrid');
    if (!host) return;

    const layout = themePageLayout();
    const pages = Math.max(1, Math.ceil(PALETTES.length / layout.perPage));
    if (state.themePageSize !== layout.perPage) {
      const firstVisible = state.themePage * state.themePageSize;
      state.themePage = clamp(Math.floor(firstVisible / layout.perPage), 0, pages - 1);
      state.themePageSize = layout.perPage;
    } else {
      state.themePage = clamp(state.themePage, 0, pages - 1);
    }

    const first = state.themePage * layout.perPage;
    const last = Math.min(first + layout.perPage, PALETTES.length);
    host.style.gridTemplateColumns = `repeat(${layout.cols}, minmax(0, 1fr))`;
    host.style.gridTemplateRows = `repeat(${layout.rows}, minmax(${layout.minHeight}px, 1fr))`;

    host.replaceChildren();
    PALETTES.slice(first, last).forEach((palette, offset) => {
      const index = first + offset;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'theme-option';
      button.dataset.theme = String(index);
      button.title = palette.name;
      button.setAttribute('aria-pressed', String(index === state.theme));
      button.style.setProperty('--theme-card-bg', palette.vars.card);
      button.style.setProperty('--theme-card-border', palette.vars.border);
      button.style.setProperty('--theme-card-text', palette.vars.white);

      const name = document.createElement('span');
      name.className = 'theme-option-name';
      name.textContent = palette.name;

      const swatch = document.createElement('span');
      swatch.className = 'theme-swatch';
      swatch.setAttribute('aria-hidden', 'true');
      VAR_NAMES.forEach((key) => {
        const chip = document.createElement('i');
        chip.style.background = palette.vars[key];
        swatch.appendChild(chip);
      });

      button.append(name, swatch);
      button.addEventListener('click', () => applyTheme(index));
      host.appendChild(button);
    });

    const pager = $('#themePager');
    if (pager) pager.hidden = pages <= 1;
    setText('themePageLabel', `${state.themePage + 1} / ${pages}`);
    const prev = $('#themePrev');
    const next = $('#themeNext');
    if (prev) prev.disabled = state.themePage <= 0;
    if (next) next.disabled = state.themePage >= pages - 1;
    markThemeSelection();
  }

  function changeThemePage(delta) {
    const pages = Math.max(1, Math.ceil(PALETTES.length / state.themePageSize));
    const next = clamp(state.themePage + delta, 0, pages - 1);
    if (next === state.themePage) return;
    state.themePage = next;
    renderThemeGrid();
  }

  function renderSetupPalette() {
    const host = $('#setupPalette');
    if (!host) return;
    host.replaceChildren();
    PALETTES.forEach((palette) => {
      const chip = document.createElement('i');
      chip.title = palette.name;
      chip.style.background = `linear-gradient(90deg, ${palette.vars.bg} 0 52%, ${palette.vars.a1} 52% 78%, ${palette.vars.a2} 78%)`;
      host.appendChild(chip);
    });
  }

  // ------------------------------------------------------------------------
  // Saved sources
  // ------------------------------------------------------------------------
  function renderSavedSources() {
    const wrapper = $('#savedSources');
    const list = $('#savedSourceList');
    if (!wrapper || !list) return;
    if (!config.sources.length) {
      wrapper.hidden = true;
      list.replaceChildren();
      return;
    }
    wrapper.hidden = false;
    list.replaceChildren();
    config.sources.slice(0, 6).forEach((source) => {
      const row = document.createElement('div');
      row.className = 'saved-source';

      const use = document.createElement('button');
      use.type = 'button';
      use.textContent = source.url;
      use.title = source.lastConnected
        ? `Last used ${formatRelative(source.lastConnected)}${source.sensorCount ? ` · ${source.sensorCount} sensors` : ''}`
        : 'Use this saved source';
      use.addEventListener('click', () => {
        const input = $('#sourceUrl');
        if (input) {
          input.value = source.url;
          input.focus();
        }
        setSetupStatus('Saved source loaded. Press Test & connect.', '');
      });

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'saved-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove saved source ${source.url}`);
      remove.addEventListener('click', () => {
        config.sources = config.sources.filter((item) => item.url !== source.url);
        saveConfig();
        renderSavedSources();
        renderSettings();
      });

      row.append(use, remove);
      list.appendChild(row);
    });
  }

  // ------------------------------------------------------------------------
  // Toast and setup status
  // ------------------------------------------------------------------------
  let toastTimer = 0;

  function toast(message, type = 'info') {
    const el = $('#toast');
    if (!el) return;
    clearTimeout(toastTimer);
    el.hidden = false;
    el.textContent = message;
    if (type === 'info') el.removeAttribute('data-type');
    else el.dataset.type = type;
    requestAnimationFrame(() => el.classList.add('is-visible'));
    toastTimer = setTimeout(() => {
      el.classList.remove('is-visible');
      setTimeout(() => { el.hidden = true; }, 180);
    }, 4600);
  }

  function setSetupStatus(message, type = '') {
    const el = $('#setupStatus');
    if (!el) return;
    el.className = 'form-status';
    if (type === 'error') el.classList.add('is-error');
    else if (type === 'success') el.classList.add('is-success');
    else if (type === 'busy') el.classList.add('is-busy');
    el.textContent = message || '';
  }

  function setSetupBusy(busy) {
    const connect = $('#connectBtn');
    const demo = $('#demoBtn');
    if (connect) {
      connect.disabled = busy;
      connect.textContent = busy ? 'Testing connection…' : 'Test & connect';
    }
    if (demo) demo.disabled = busy;
  }

  // ------------------------------------------------------------------------
  // Demo telemetry
  // ------------------------------------------------------------------------
  function stepDemo(manual = false) {
    const data = state.demoData;
    if (!data) return;
    data.cpu.temp = clamp(data.cpu.temp + (Math.random() - 0.48) * 2.4, 34, 86);
    data.cpu.load = clamp(data.cpu.load + (Math.random() - 0.5) * 9, 3, 96);
    data.cpu.power = clamp(data.cpu.power + (Math.random() - 0.5) * 4, 24, 110);
    data.cpu.fan = clamp(Math.round(data.cpu.fan + (Math.random() - 0.5) * 30), 900, 1600);
    data.gpu.temp = clamp(data.gpu.temp + (Math.random() - 0.48) * 2.8, 38, 88);
    data.gpu.hot = clamp(data.gpu.temp + 10 + (Math.random() - 0.5) * 3, 45, 98);
    data.gpu.load = clamp(data.gpu.load + (Math.random() - 0.5) * 12, 2, 99);
    data.gpu.vramUsed = clamp(data.gpu.vramUsed + (Math.random() - 0.5) * 260, 3800, 7800);
    data.ram.pct = clamp(data.ram.pct + (Math.random() - 0.5) * 1.8, 26, 72);
    data.ram.used = (data.ram.pct / 100) * data.ram.total;

    if (state.mode !== 'demo') return;

    state.telemetry = data;
    state.lastSuccess = Date.now();
    pushHistory(state.history.cpu, data.cpu.temp);
    pushHistory(state.history.gpu, data.gpu.temp);
    state.historyMeta.cpu = 'temp';
    state.historyMeta.gpu = 'temp';
    if (state.page === 'monitor') renderMonitor();
    renderStatus();
    if (manual) drawAllSparks();
  }

  // ------------------------------------------------------------------------
  // URL handling and source switching
  // ------------------------------------------------------------------------
  function normalizeSourceUrl(value) {
    let raw = String(value || '').trim();
    if (!raw) throw new Error('Enter the LibreHardwareMonitor data.json URL first.');
    if (raw.startsWith('//')) raw = 'http:' + raw;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = 'http://' + raw;

    let url;
    try {
      url = new URL(raw);
    } catch (err) {
      throw new Error('That does not look like a valid URL. Example: http://192.168.1.50:8085/data.json');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Only http:// and https:// URLs are supported.');
    }
    if (url.username || url.password) {
      throw new Error('Remove the username and password from the URL. Credentials are not stored.');
    }
    url.hash = '';
    if (!url.pathname || url.pathname === '/') url.pathname = '/data.json';
    else if (url.pathname.endsWith('/')) url.pathname += 'data.json';
    return url.href;
  }

  function updateSources(url, sensorCount, lhmVersion) {
    const entry = {
      url,
      lastConnected: Date.now(),
      sensorCount: Number(sensorCount) || 0,
      lhmVersion: lhmVersion || '',
    };
    config.sources = [entry, ...config.sources.filter((item) => item.url !== url)].slice(0, 6);
  }

  async function probeSource(url) {
    const fetched = await fetchJson(url);
    const scan = scanLhm(fetched.json);
    if (!scan.data.valid) {
      throw sourceError(
        'The JSON responded, but no CPU, GPU or RAM sensors were found. Enable the sensor categories in LibreHardwareMonitor and check the endpoint again.',
        'sensors',
        { latency: fetched.latency, status: fetched.response.status, contentType: fetched.contentType }
      );
    }
    return { fetched, scan };
  }

  function recordRequest(entry) {
    state.requestLog.unshift({
      at: Date.now(),
      ok: !!entry.ok,
      latency: entry.latency == null ? null : entry.latency,
      http: entry.http == null ? null : entry.http,
      label: entry.label || 'fetch',
      message: entry.message || '',
    });
    state.requestLog = state.requestLog.slice(0, 6);
    if (state.monitorView === 'network') renderNetwork();
  }

  function bumpFetchToken() {
    state.fetchToken++;
    state.inFlight = null;
    state.fetching = false;
    clearTimeout(state.fetchTimer);
    state.fetchTimer = 0;
  }

  function startLiveState() {
    bumpFetchToken();
    state.mode = 'live';
    config.mode = 'live';
    state.telemetry = emptyTelemetry();
    resetHistory();
    state.lastSuccess = 0;
    state.lastError = '';
    state.latency = null;
    state.httpStatus = null;
    state.contentType = '';
    state.sensorCount = null;
    state.lhmVersion = '';
    saveConfig();
    renderMonitor();
    renderStatus();
    renderSettings();
    renderNetwork();
  }

  function activateSource(url) {
    if (!url) return;
    if (state.mode === 'live' && url === config.activeUrl) {
      refreshNow();
      return;
    }
    config.activeUrl = url;
    config.mode = 'live';
    state.configured = true;
    startLiveState();
    toast(`Connecting to ${endpointHost(url)}…`);
    pollLive(false);
  }

  function setDemoState() {
    bumpFetchToken();
    state.mode = 'demo';
    state.configured = true;
    config.mode = 'demo';
    state.demoData = makeDemoTelemetry();
    state.telemetry = state.demoData;
    resetHistory();
    seedDemoHistory();
    state.lastSuccess = Date.now();
    state.lastError = '';
    state.latency = null;
    state.httpStatus = null;
    state.contentType = '';
    state.sensorCount = null;
    state.lhmVersion = 'DEMO';
    saveConfig();
    renderMonitor();
    renderStatus();
    renderSettings();
    renderNetwork();
  }

  function activateDemo() {
    state.setupAttempt++;
    setDemoState();
    closeSetupToApp();
    setPage('monitor');
    toast('Demo mode is active. Values are generated locally, not read from LibreHardwareMonitor.');
  }

  function commitProbe(url, scan, fetched) {
    bumpFetchToken();
    config.activeUrl = url;
    config.mode = 'live';
    state.mode = 'live';
    state.configured = true;
    state.lastSuccess = 0;
    state.lastError = '';
    state.latency = fetched.latency;
    state.httpStatus = fetched.response.status;
    state.contentType = fetched.contentType;
    state.sensorCount = scan.sensorCount;
    state.lhmVersion = typeof fetched.json.Version === 'string' ? fetched.json.Version : '';
    resetHistory();
    applyLiveScan(scan, fetched);
    updateSources(url, scan.sensorCount, state.lhmVersion);
    saveConfig();
    renderSettings();
    renderStatus();
    closeSetupToApp();
    setPage('monitor');
    scheduleLive();
  }

  async function handleSetupSubmit(event) {
    event.preventDefault();
    const input = $('#sourceUrl');
    const raw = input ? input.value : '';
    let url;
    try {
      url = normalizeSourceUrl(raw);
    } catch (err) {
      setSetupStatus(err.message, 'error');
      if (input) input.focus();
      return;
    }
    if (input) input.value = url;
    if (isMixedContent(url)) {
      const warning = $('#secureWarning');
      if (warning) warning.hidden = false;
      setSetupStatus('Mixed content blocked. Open this app over HTTP or use an HTTPS proxy for LHM.', 'error');
      return;
    }

    const attempt = ++state.setupAttempt;
    setSetupBusy(true);
    setSetupStatus('Testing the endpoint…', 'busy');

    try {
      const { fetched, scan } = await probeSource(url);
      if (attempt !== state.setupAttempt) return;
      recordRequest({
        ok: true,
        latency: fetched.latency,
        http: fetched.response.status,
        label: 'test',
        message: `${scan.sensorCount} sensors`,
      });
      commitProbe(url, scan, fetched);
      setSetupStatus(`Connected · ${scan.sensorCount} sensors · ${fetched.latency} ms`, 'success');
      toast(`Connected to LibreHardwareMonitor · ${scan.sensorCount} sensors found.`, 'success');
    } catch (err) {
      if (attempt !== state.setupAttempt) return;
      const message = explainError(err, url);
      setSetupStatus(message, 'error');
      recordRequest({
        ok: false,
        latency: err && err.latency,
        http: err && err.status,
        label: 'test',
        message,
      });
    } finally {
      if (attempt === state.setupAttempt) setSetupBusy(false);
    }
  }

  function forgetSource() {
    if (!config.activeUrl) {
      toast('No saved source to forget.');
      return;
    }
    if (!window.confirm('Forget the saved LibreHardwareMonitor source and switch to demo mode?')) return;
    const oldUrl = config.activeUrl;
    config.activeUrl = '';
    config.sources = config.sources.filter((item) => item.url !== oldUrl);
    setDemoState();
    saveConfig();
    renderSavedSources();
    renderSettings();
    renderStatus();
    toast('Saved source removed. Demo mode is active.');
  }

  function refreshNow() {
    if (state.mode === 'demo') {
      stepDemo(true);
      toast('Demo telemetry refreshed locally. Connect a source for real sensors.');
      return;
    }
    if (!config.activeUrl) {
      showSetup();
      return;
    }
    if (state.fetching) {
      toast('A telemetry fetch is already in progress.');
      return;
    }
    pollLive(true);
  }

  // ------------------------------------------------------------------------
  // View switching
  // ------------------------------------------------------------------------
  function showSetup() {
    state.setupAttempt++;
    const setup = $('#setup');
    const app = $('#app');
    if (!setup || !app) return;
    setup.hidden = false;
    app.hidden = true;
    setup.inert = false;
    app.inert = true;

    const close = $('#closeSetup');
    if (close) close.hidden = !(state.configured && (config.activeUrl || config.mode === 'demo' || config.sources.length));
    const input = $('#sourceUrl');
    if (input) input.value = config.activeUrl || (config.sources[0] ? config.sources[0].url : '');
    setSetupStatus('');
    setSetupBusy(false);
    const warning = $('#secureWarning');
    if (warning) warning.hidden = location.protocol !== 'https:';
    renderSavedSources();
    window.scrollTo({ top: 0, behavior: 'auto' });
    setTimeout(() => {
      if (input) {
        input.focus({ preventScroll: true });
        input.select();
      }
    }, 60);
  }

  function initialPage() {
    const hash = location.hash.replace('#', '');
    return PAGES.includes(hash) ? hash : 'monitor';
  }

  function showDashboard() {
    const setup = $('#setup');
    const app = $('#app');
    if (!setup || !app) return;
    setup.hidden = true;
    app.hidden = false;
    setup.inert = true;
    app.inert = false;
    setPage(initialPage(), false);
    requestAnimationFrame(() => {
      drawAllSparks();
      if (state.page === 'animation') resizeAnimation();
    });
  }

  function closeSetupToApp() {
    if (!config.activeUrl && state.mode === 'live') setDemoState();
    showDashboard();
    if (state.mode === 'live') {
      if (state.lastSuccess) scheduleLive();
      else if (!state.fetching) pollLive(false);
    }
  }

  // ------------------------------------------------------------------------
  // Live polling
  // ------------------------------------------------------------------------
  function applyLiveScan(scan, fetched) {
    const data = scan.data;
    state.telemetry = data;
    state.lastSuccess = Date.now();
    state.lastError = '';
    state.latency = fetched.latency;
    state.httpStatus = fetched.response.status;
    state.contentType = fetched.contentType;
    state.sensorCount = scan.sensorCount;
    state.lhmVersion = typeof fetched.json.Version === 'string' ? fetched.json.Version : '';

    const cpuValue = data.cpu.hasTemp ? data.cpu.temp : (data.cpu.hasLoad ? data.cpu.load : 0);
    const gpuValue = data.gpu.hasTemp ? data.gpu.temp : (data.gpu.hasLoad ? data.gpu.load : 0);
    state.historyMeta.cpu = data.cpu.hasTemp ? 'temp' : 'load';
    state.historyMeta.gpu = data.gpu.hasTemp ? 'temp' : 'load';
    if (data.cpu.hasTemp || data.cpu.hasLoad) pushHistory(state.history.cpu, cpuValue);
    if (data.gpu.hasTemp || data.gpu.hasLoad) pushHistory(state.history.gpu, gpuValue);

    renderMonitor();
    renderStatus();
    renderSettings();
    renderNetwork();
  }

  function pollLive(manual = false) {
    if (state.mode !== 'live' || !config.activeUrl) return Promise.resolve();
    if (state.inFlight) {
      if (manual) toast('A telemetry fetch is already in progress.');
      return state.inFlight;
    }
    if (document.hidden && !manual) return Promise.resolve();

    const token = state.fetchToken;
    const url = config.activeUrl;
    state.fetching = true;
    renderStatus();

    state.inFlight = (async () => {
      try {
        const fetched = await fetchJson(url);
        if (token !== state.fetchToken) return;
        const scan = scanLhm(fetched.json);
        if (!scan.data.valid) {
          throw sourceError(
            'The endpoint returned JSON, but no CPU, GPU or RAM sensors were found. Enable the sensor categories in LibreHardwareMonitor and try again.',
            'sensors',
            { latency: fetched.latency, status: fetched.response.status, contentType: fetched.contentType }
          );
        }
        applyLiveScan(scan, fetched);
        recordRequest({
          ok: true,
          latency: fetched.latency,
          http: fetched.response.status,
          label: 'poll',
          message: `${scan.sensorCount} sensors`,
        });
        if (manual) toast(`Live telemetry updated · ${scan.sensorCount} sensors.`, 'success');
      } catch (err) {
        if (token !== state.fetchToken) return;
        const message = explainError(err, url);
        state.lastError = message;
        recordRequest({
          ok: false,
          latency: err && err.latency,
          http: err && err.status,
          label: 'poll',
          message,
        });
        if (manual) toast(message, 'error');
        const status = effectiveStatus();
        updateSourceMeta(status);
        setBanner(status);
        renderNetwork();
      } finally {
        if (token !== state.fetchToken) return;
        state.fetching = false;
        state.inFlight = null;
        renderStatus();
        renderNetwork();
        scheduleLive();
      }
    })();

    return state.inFlight;
  }

  function scheduleLive(delay = config.interval) {
    clearTimeout(state.fetchTimer);
    state.fetchTimer = 0;
    if (state.mode !== 'live' || !config.activeUrl || document.hidden) return;
    state.fetchTimer = setTimeout(() => pollLive(false), Math.max(1000, Number(delay) || 3000));
  }

  // ------------------------------------------------------------------------
  // Clock (browser local time, computed GMT offset)
  // ------------------------------------------------------------------------
  let dateFormatter = null;

  function updateClock() {
    const now = new Date();
    const hh = pad(now.getHours());
    const mm = pad(now.getMinutes());
    const ss = pad(now.getSeconds());
    setText('clockTime', `${hh}:${mm}:${ss}`);
    setText('clockSeconds', ss);

    if (!dateFormatter) {
      try {
        dateFormatter = new Intl.DateTimeFormat(undefined, {
          weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
        });
      } catch (err) {
        dateFormatter = null;
      }
    }
    let dateText = '';
    try {
      dateText = dateFormatter ? dateFormatter.format(now) : now.toDateString();
    } catch (err) {
      dateText = now.toDateString();
    }
    setText('clockDate', dateText.toLocaleUpperCase());

    const offsetMinutes = -now.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMinutes);
    const offset = `GMT${sign}${Math.floor(abs / 60)}${abs % 60 ? ':' + pad(abs % 60) : ''}`;
    let zone = 'LOCAL';
    try {
      zone = (Intl.DateTimeFormat().resolvedOptions().timeZone || 'LOCAL').replace(/_/g, ' ').toUpperCase();
    } catch (err) {
      zone = 'LOCAL';
    }
    setText('clockOffset', offset);
    setText('clockOffsetFoot', offset);
    setText('clockZone', zone);
    setText('timeZoneChip', `${zone} · ${offset}`);

    const bar = $('#secondsBar');
    if (bar) bar.style.width = `${(now.getSeconds() / 59) * 100}%`;
  }

  // ------------------------------------------------------------------------
  // Pomodoro
  // ------------------------------------------------------------------------
  function buildPomodoro() {
    const blocks = $('#pomoBlocks');
    if (blocks) {
      blocks.replaceChildren();
      for (let i = 0; i < 24; i++) {
        const block = document.createElement('i');
        blocks.appendChild(block);
      }
    }
    const dots = $('#sessionDots');
    if (dots) {
      dots.replaceChildren();
      for (let i = 0; i < 5; i++) dots.appendChild(document.createElement('i'));
    }
    updatePomodoro();
  }

  function pomoSeconds() {
    const p = state.pomo;
    if (p.finished) return 0;
    if (p.active || p.paused) return Math.ceil(p.remaining / 1000);
    return p.minutes * 60;
  }

  function updatePomodoro() {
    const p = state.pomo;
    const secs = Math.max(0, pomoSeconds());
    setText('pomoDigits', `${pad(Math.floor(secs / 60))}:${pad(secs % 60)}`);

    const status = $('#pomoStatus');
    if (status) {
      status.className = 'pomo-status';
      if (p.finished) {
        status.classList.add('is-complete');
        status.textContent = 'COMPLETE';
      } else if (p.active) {
        status.classList.add('is-running');
        status.textContent = 'FOCUSING';
      } else if (p.paused) {
        status.classList.add('is-paused');
        status.textContent = 'PAUSED';
      } else {
        status.textContent = 'READY';
      }
    }

    let pct = p.finished ? 0 : 1;
    if (!p.finished && p.duration > 0 && (p.active || p.paused)) pct = p.remaining / p.duration;
    const activeBlocks = p.finished ? 0 : clamp(Math.ceil(pct * 24), 0, 24);
    const blocks = $('#pomoBlocks');
    if (blocks) {
      blocks.classList.toggle('is-running', p.active && !p.finished);
      blocks.classList.toggle('is-paused', p.paused && !p.active);
      blocks.classList.toggle('is-complete', p.finished);
      Array.from(blocks.children).forEach((block, i) => {
        block.classList.toggle('is-on', i < activeBlocks);
      });
    }

    const start = $('#pomoStart');
    if (start) start.textContent = p.active ? 'Pause' : (p.paused ? 'Resume' : 'Start');

    const locked = p.active;
    ['pomoMinus', 'pomoPlus'].forEach((id) => {
      const button = document.getElementById(id);
      if (button) button.disabled = locked;
    });
    $$('.preset').forEach((button) => {
      button.disabled = locked;
      button.classList.toggle('is-selected', Number(button.dataset.min) === p.minutes);
    });

    setText('pomoSessions', String(p.sessions));
    const dots = $('#sessionDots');
    if (dots) {
      const shown = Math.min(p.sessions, 5);
      Array.from(dots.children).forEach((dot, i) => dot.classList.toggle('is-on', i < shown));
      dots.setAttribute('aria-label', `${p.sessions} completed sessions`);
    }
  }

  function triggerAlarm() {
    const app = $('#app');
    if (!app) return;
    app.classList.remove('alarm');
    void app.offsetWidth;
    app.classList.add('alarm');
    setTimeout(() => app.classList.remove('alarm'), 4200);
    toast('Pomodoro complete. Take a short break.', 'success');
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
      p.duration = 0;
      p.sessions++;
      triggerAlarm();
      updatePomodoro();
      setTimeout(() => {
        if (state.pomo.finished) {
          state.pomo.finished = false;
          updatePomodoro();
        }
      }, 4200);
      return;
    }
    updatePomodoro();
  }

  // ------------------------------------------------------------------------
  // Animations — responsive versions of the firmware's three modes
  // ------------------------------------------------------------------------
  const anim = {
    canvas: null,
    ctx: null,
    W: 0,
    H: 0,
    dpr: 1,
    matrix: [],
    stars: [],
    dvd: null,
    lastTime: 0,
    frames: 0,
    fpsWindow: 0,
    fps: 0,
  };

  function resizeAnimation() {
    const stage = $('#animStage');
    const canvas = $('#animCanvas');
    if (!stage || !canvas) return;
    const rect = stage.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelW = Math.round(rect.width * dpr);
    const pixelH = Math.round(rect.height * dpr);
    if (canvas.width !== pixelW) canvas.width = pixelW;
    if (canvas.height !== pixelH) canvas.height = pixelH;

    anim.canvas = canvas;
    anim.ctx = canvas.getContext('2d');
    anim.W = rect.width;
    anim.H = rect.height;
    anim.dpr = dpr;
    if (!anim.ctx) return;
    anim.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    initAnimation();
  }

  function initAnimation() {
    if (!anim.ctx) return;
    state.animMode = ((state.animMode % ANIM_NAMES.length) + ANIM_NAMES.length) % ANIM_NAMES.length;
    const W = anim.W;
    const H = anim.H;
    const palette = PALETTES[state.theme].vars;

    if (state.animMode === 0) {
      const count = clamp(Math.round(W / 20), 24, 96);
      const cell = clamp(H / 26, 12, 24);
      const top = 12;
      const bottom = Math.max(top + 40, H - 46);
      anim.matrix = Array.from({ length: count }, (_, i) => ({
        x: count > 1 ? 20 + (i * Math.max(1, W - 40)) / (count - 1) : W / 2,
        y: top + Math.random() * Math.max(30, (bottom - top) * 0.55),
        speed: (80 + Math.random() * 80) * (H / 288),
        len: 4 + Math.random() * 5,
        cell,
      }));
    } else if (state.animMode === 1) {
      const count = clamp(Math.round((W * H) / 2500), 160, 420);
      anim.stars = Array.from({ length: count }, () => ({
        x: Math.random() * W - W / 2,
        y: Math.random() * H - H / 2,
        z: 10 + Math.random() * 290,
      }));
    } else {
      const w = clamp(W * 0.17, 84, 220);
      const h = w * 0.42;
      anim.dvd = {
        x: Math.max(12, W * 0.18),
        y: Math.max(12, H * 0.16),
        vx: 1,
        vy: 1,
        w,
        h,
        color: visibleOnDark(palette.a1, 150),
        marginX: Math.max(8, W * 0.02),
        marginY: Math.max(8, H * 0.03),
      };
    }

    anim.ctx.fillStyle = '#000';
    anim.ctx.fillRect(0, 0, W, H);
    updateAnimHud(0);
  }

  function drawMatrix(dt) {
    const ctx = anim.ctx;
    const H = anim.H;
    const W = anim.W;
    const palette = PALETTES[state.theme].vars;
    const accent = visibleOnDark(palette.a3, 150);
    const head = visibleOnDark(palette.white, 220);
    const top = 12;
    const bottom = Math.max(top + 40, H - 46);
    const glyphs = '0123456789ABCDEFXYZ#*+<>$%&';

    ctx.fillStyle = 'rgba(0,0,0,0.17)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    anim.matrix.forEach((col) => {
      ctx.font = `600 ${Math.round(col.cell * 0.9)}px ui-monospace, Consolas, monospace`;
      for (let k = 0; k < col.len; k++) {
        const gy = col.y - k * col.cell;
        if (gy < top || gy + col.cell > bottom) continue;
        const ch = glyphs[(Math.random() * glyphs.length) | 0];
        if (k === 0) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = head;
        } else {
          ctx.globalAlpha = Math.max(0.08, 1 - k / col.len);
          ctx.fillStyle = accent;
        }
        ctx.fillText(ch, col.x, gy);
      }
      ctx.globalAlpha = 1;
      col.y += col.speed * dt;
      if (col.y - col.len * col.cell > bottom) {
        col.y = top + Math.random() * 30;
        col.speed = (80 + Math.random() * 80) * (H / 288);
        col.len = 4 + Math.random() * 5;
      }
    });
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  function drawStars(dt) {
    const ctx = anim.ctx;
    const W = anim.W;
    const H = anim.H;
    const palette = PALETTES[state.theme].vars;
    const near = visibleOnDark(palette.white, 220);
    const mid = visibleOnDark(palette.a1, 170);
    const far = visibleOnDark(palette.dark, 170);
    const focal = Math.min(W, H) * 0.42;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    anim.stars.forEach((star) => {
      const px = W / 2 + (star.x / star.z) * focal;
      const py = H / 2 + (star.y / star.z) * focal;
      if (px >= 0 && px <= W && py >= 0 && py <= H) {
        const size = clamp((1 - star.z / 300) * 5, 1.2, 4.5);
        ctx.fillStyle = star.z < 90 ? near : (star.z < 190 ? mid : far);
        ctx.fillRect(px, py, size, size);
      }
      star.z -= 240 * dt * (H / 288);
      if (star.z <= 2) {
        star.x = Math.random() * W - W / 2;
        star.y = Math.random() * H - H / 2;
        star.z = 300;
      }
    });
  }

  function drawDvd(dt) {
    const ctx = anim.ctx;
    const W = anim.W;
    const H = anim.H;
    const dvd = anim.dvd;
    if (!dvd) return;
    const palette = PALETTES[state.theme].vars;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    const vx = Math.max(180, W * 0.38);
    const vy = Math.max(120, H * 0.42);
    dvd.x += dvd.vx * vx * dt;
    dvd.y += dvd.vy * vy * dt;

    let hit = false;
    if (dvd.vx < 0 && dvd.x <= dvd.marginX) {
      dvd.x = dvd.marginX;
      dvd.vx = 1;
      hit = true;
    } else if (dvd.vx > 0 && dvd.x + dvd.w >= W - dvd.marginX) {
      dvd.x = W - dvd.marginX - dvd.w;
      dvd.vx = -1;
      hit = true;
    }
    if (dvd.vy < 0 && dvd.y <= dvd.marginY) {
      dvd.y = dvd.marginY;
      dvd.vy = 1;
      hit = true;
    } else if (dvd.vy > 0 && dvd.y + dvd.h >= H - dvd.marginY) {
      dvd.y = H - dvd.marginY - dvd.h;
      dvd.vy = -1;
      hit = true;
    }
    if (hit) {
      const colors = [palette.a1, palette.a2, palette.a3, palette.gold, palette.cool, palette.warm];
      dvd.color = visibleOnDark(colors[(Math.random() * colors.length) | 0], 150);
    }

    ctx.save();
    ctx.shadowColor = dvd.color;
    ctx.shadowBlur = 16;
    ctx.fillStyle = dvd.color;
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(dvd.x, dvd.y, dvd.w, dvd.h, 8);
      ctx.fill();
    } else {
      ctx.fillRect(dvd.x, dvd.y, dvd.w, dvd.h);
    }
    ctx.restore();

    ctx.fillStyle = '#000';
    ctx.font = `800 ${Math.round(dvd.h * 0.36)}px ui-monospace, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('CYD 3.5', dvd.x + dvd.w / 2, dvd.y + dvd.h / 2 + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  function updateAnimHud(fpsValue) {
    const hud = $('#animHud');
    if (!hud) return;
    hud.textContent = `MODE: ${ANIM_NAMES[state.animMode]} · FPS: ${fpsValue > 0 ? fmt(fpsValue) : '--'}`;
  }

  function animationLoop(now) {
    const dt = anim.lastTime ? Math.min((now - anim.lastTime) / 1000, 0.1) : 1 / 60;
    anim.lastTime = now;

    if (state.page === 'animation' && !document.hidden) {
      if (!anim.ctx || anim.W < 8 || anim.H < 8) resizeAnimation();
      if (anim.ctx) {
        if (state.animMode === 0) drawMatrix(dt);
        else if (state.animMode === 1) drawStars(dt);
        else drawDvd(dt);

        anim.frames++;
        if (now - anim.fpsWindow >= 1000) {
          anim.fps = (anim.frames * 1000) / Math.max(1, now - anim.fpsWindow);
          anim.frames = 0;
          anim.fpsWindow = now;
          updateAnimHud(anim.fps);
        }
      }
    }
    requestAnimationFrame(animationLoop);
  }

  function cycleAnimation(delta = 1) {
    state.animMode = (state.animMode + delta + ANIM_NAMES.length) % ANIM_NAMES.length;
    initAnimation();
  }

  function enterAnimation() {
    requestAnimationFrame(() => {
      resizeAnimation();
      anim.lastTime = performance.now();
    });
  }

  // ------------------------------------------------------------------------
  // Page and monitor-view navigation
  // ------------------------------------------------------------------------
  function setClockView(view) {
    state.clockView = view === 'pomodoro' ? 'pomodoro' : 'clock';
    const clock = $('#clockView');
    const pomo = $('#pomoView');
    if (clock) clock.hidden = state.clockView !== 'clock';
    if (pomo) pomo.hidden = state.clockView !== 'pomodoro';
    if (state.clockView === 'pomodoro') updatePomodoro();
    else updateClock();
  }

  function setSettingsTab(tab) {
    state.settingsTab = SETTINGS_TABS.includes(tab) ? tab : 'source';
    $$('.settings-tab').forEach((button) => {
      const on = button.dataset.settingsTab === state.settingsTab;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-selected', String(on));
    });
    $$('[data-settings-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.settingsPanel !== state.settingsTab;
    });
    if (state.settingsTab === 'themes') renderThemeGrid();
    else if (state.settingsTab === 'source') renderSettings();
  }

  function setPage(name, updateHash = true) {
    const page = PAGES.includes(name) ? name : 'monitor';
    state.page = page;
    $$('.page').forEach((section) => {
      section.classList.toggle('is-active', section.dataset.page === page);
    });
    $$('.nav-button').forEach((button) => {
      const on = button.dataset.page === page;
      button.classList.toggle('is-active', on);
      if (on) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });

    if (page === 'monitor') {
      renderMonitor();
      renderStatus();
      if (state.monitorView === 'network') renderNetwork();
    } else if (page === 'clock') {
      setClockView(state.clockView);
      updateClock();
      updatePomodoro();
    } else if (page === 'animation') {
      enterAnimation();
    } else if (page === 'settings') {
      setSettingsTab(state.settingsTab);
    }

    if (updateHash) {
      try {
        history.replaceState(null, '', '#' + page);
      } catch (err) {
        // file:// or a restricted history context
      }
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function setMonitorView(view) {
    const target = view === 'network' ? 'network' : 'hardware';
    state.monitorView = target;
    $$('[data-monitor-view]').forEach((button) => {
      const on = button.dataset.monitorView === target;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-selected', String(on));
    });
    $$('[data-monitor-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.monitorPanel !== target;
    });
    if (target === 'network') renderNetwork();
    else {
      renderMonitor();
      requestAnimationFrame(drawAllSparks);
    }
  }

  // ------------------------------------------------------------------------
  // Diagnostics clipboard
  // ------------------------------------------------------------------------
  function diagnosticsText() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const lines = [
      'CYD Monitor Web diagnostics',
      `Generated: ${new Date().toISOString()}`,
      `Page: ${location.href}`,
      `Mode: ${state.mode}`,
      `Status: ${effectiveStatus()}`,
      `Endpoint: ${config.activeUrl || 'none (demo mode)'}`,
      `LHM version: ${state.lhmVersion || 'unknown'}`,
      `Sensors: ${state.sensorCount == null ? 'unknown' : state.sensorCount}`,
      `HTTP status: ${state.httpStatus == null ? 'n/a' : state.httpStatus}`,
      `Response time: ${state.latency == null ? 'n/a' : state.latency + ' ms'}`,
      `Content type: ${state.contentType || 'n/a'}`,
      `Last success: ${state.lastSuccess ? new Date(state.lastSuccess).toISOString() : 'never'}`,
      `Last error: ${state.lastError || 'none'}`,
      `Browser online: ${navigator.onLine}`,
      `Page protocol: ${location.protocol}`,
      `Effective network type: ${conn && conn.effectiveType ? conn.effectiveType : 'not exposed'}`,
      `Downlink: ${conn && Number.isFinite(conn.downlink) ? conn.downlink + ' Mb/s' : 'not exposed'}`,
      `RTT: ${conn && Number.isFinite(conn.rtt) ? conn.rtt + ' ms' : 'not exposed'}`,
      'Note: browser APIs do not expose Wi-Fi SSID, RSSI, channel, local IP, gateway or DNS.',
    ];
    if (state.requestLog.length) {
      lines.push('Recent requests:');
      state.requestLog.forEach((entry) => {
        lines.push(`  ${new Date(entry.at).toISOString()} ${entry.ok ? 'OK' : 'ERR'} ${entry.label} ${entry.http == null ? '' : 'HTTP ' + entry.http} ${entry.latency == null ? '' : entry.latency + 'ms'} ${entry.message}`);
      });
    }
    return lines.join('\n');
  }

  function fallbackCopy(text) {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (err) {
      ok = false;
    }
    area.remove();
    return ok;
  }

  async function copyDiagnostics() {
    const text = diagnosticsText();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        toast('Diagnostics copied to the clipboard.', 'success');
        return;
      }
    } catch (err) {
      // fall through to the textarea fallback
    }
    if (fallbackCopy(text)) toast('Diagnostics copied to the clipboard.', 'success');
    else toast('Could not access the clipboard. The Network view lists the same information.', 'error');
  }

  // ------------------------------------------------------------------------
  // Events
  // ------------------------------------------------------------------------
  function bindEvents() {
    $$('.nav-button').forEach((button) => {
      button.addEventListener('click', () => setPage(button.dataset.page));
    });

    $$('[data-nav]').forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        const app = $('#app');
        if (app && !app.hidden) setPage('monitor');
        else {
          const input = $('#sourceUrl');
          if (input) input.focus();
        }
      });
    });

    $$('[data-monitor-view]').forEach((button) => {
      button.addEventListener('click', () => setMonitorView(button.dataset.monitorView));
    });

    const clockToPomodoro = $('#clockToPomodoro');
    if (clockToPomodoro) clockToPomodoro.addEventListener('click', () => setClockView('pomodoro'));
    const pomodoroToClock = $('#pomodoroToClock');
    if (pomodoroToClock) pomodoroToClock.addEventListener('click', () => setClockView('clock'));

    $$('.settings-tab').forEach((button) => {
      button.addEventListener('click', () => setSettingsTab(button.dataset.settingsTab));
    });
    const styleToggle = $('#styleBrutalist');
    if (styleToggle) {
      styleToggle.addEventListener('change', () => {
        applyStyle(styleToggle.checked ? 'brutalist' : 'cyd');
        saveConfig();
        if (state.page === 'settings' && state.settingsTab === 'themes') renderThemeGrid();
        requestAnimationFrame(() => {
          drawAllSparks();
          if (state.page === 'animation') resizeAnimation();
        });
        toast(styleToggle.checked ? 'Neo Brutalist style enabled.' : 'CYD style restored.');
      });
    }
    const themePrev = $('#themePrev');
    if (themePrev) themePrev.addEventListener('click', () => changeThemePage(-1));
    const themeNext = $('#themeNext');
    if (themeNext) themeNext.addEventListener('click', () => changeThemePage(1));

    ['refreshButton', 'refreshButton2'].forEach((id) => {
      const button = document.getElementById(id);
      if (button) button.addEventListener('click', refreshNow);
    });
    ['sourceButton', 'sourceOpen', 'settingsSource'].forEach((id) => {
      const button = document.getElementById(id);
      if (button) button.addEventListener('click', showSetup);
    });

    const bannerAction = $('#bannerAction');
    if (bannerAction) {
      bannerAction.addEventListener('click', () => {
        if (bannerAction.dataset.action === 'retry') refreshNow();
        else showSetup();
      });
    }

    const setupForm = $('#setupForm');
    if (setupForm) setupForm.addEventListener('submit', handleSetupSubmit);
    const demo = $('#demoBtn');
    if (demo) demo.addEventListener('click', activateDemo);
    const close = $('#closeSetup');
    if (close) {
      close.addEventListener('click', () => {
        state.setupAttempt++;
        closeSetupToApp();
      });
    }
    const sourceInput = $('#sourceUrl');
    if (sourceInput) {
      sourceInput.addEventListener('input', () => {
        const status = $('#setupStatus');
        if (status && status.classList.contains('is-error')) setSetupStatus('');
      });
    }

    const diagnostics = $('#settingsDiagnostics');
    if (diagnostics) {
      diagnostics.addEventListener('click', () => {
        setPage('monitor');
        setMonitorView('network');
      });
    }
    const copy = $('#copyDiagnostics');
    if (copy) copy.addEventListener('click', copyDiagnostics);

    const interval = $('#intervalSelect');
    if (interval) {
      interval.addEventListener('change', () => {
        const value = Number(interval.value);
        if (!ALLOWED_INTERVALS.includes(value)) return;
        config.interval = value;
        saveConfig();
        if (state.mode === 'live') scheduleLive();
        toast(`Live refresh interval set to ${value / 1000}s.`);
      });
    }

    const start = $('#pomoStart');
    if (start) {
      start.addEventListener('click', () => {
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
        updatePomodoro();
      });
    }
    const reset = $('#pomoReset');
    if (reset) {
      reset.addEventListener('click', () => {
        const p = state.pomo;
        p.active = false;
        p.paused = false;
        p.finished = false;
        p.remaining = 0;
        p.duration = 0;
        const app = $('#app');
        if (app) app.classList.remove('alarm');
        updatePomodoro();
      });
    }
    const minus = $('#pomoMinus');
    if (minus) {
      minus.addEventListener('click', () => {
        if (state.pomo.active) return;
        state.pomo.minutes = clamp(state.pomo.minutes - 1, 1, 60);
        state.pomo.paused = false;
        state.pomo.finished = false;
        state.pomo.remaining = 0;
        updatePomodoro();
      });
    }
    const plus = $('#pomoPlus');
    if (plus) {
      plus.addEventListener('click', () => {
        if (state.pomo.active) return;
        state.pomo.minutes = clamp(state.pomo.minutes + 1, 1, 60);
        state.pomo.paused = false;
        state.pomo.finished = false;
        state.pomo.remaining = 0;
        updatePomodoro();
      });
    }
    $$('.preset').forEach((button) => {
      button.addEventListener('click', () => {
        if (state.pomo.active) return;
        state.pomo.minutes = Number(button.dataset.min) || 25;
        state.pomo.remaining = 0;
        state.pomo.paused = false;
        state.pomo.finished = false;
        updatePomodoro();
      });
    });

    const prev = $('#animPrev');
    if (prev) prev.addEventListener('click', () => cycleAnimation(-1));
    const next = $('#animNext');
    if (next) next.addEventListener('click', () => cycleAnimation(1));
    const stage = $('#animStage');
    if (stage) {
      stage.addEventListener('click', () => cycleAnimation(1));
      stage.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          cycleAnimation(1);
        }
      });
    }

    document.addEventListener('keydown', (event) => {
      const tag = event.target && event.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if ((event.key === '1' || event.key === '2' || event.key === '3' || event.key === '4') && $('#app') && !$('#app').hidden) {
        setPage(PAGES[Number(event.key) - 1]);
      } else if (event.key.toLowerCase() === 'r' && $('#app') && !$('#app').hidden) {
        refreshNow();
      } else if (state.page === 'animation' && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
        cycleAnimation(event.key === 'ArrowRight' ? 1 : -1);
      } else if (event.key === 'Escape' && $('#setup') && !$('#setup').hidden) {
        const closeButton = $('#closeSetup');
        if (closeButton && !closeButton.hidden) {
          state.setupAttempt++;
          closeSetupToApp();
        }
      }
    });

    window.addEventListener('hashchange', () => {
      const app = $('#app');
      if (app && !app.hidden) setPage(initialPage(), false);
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      updateClock();
      renderStatus();
      if (state.mode === 'live' && config.activeUrl) {
        if (!state.lastSuccess || state.lastError || Date.now() - state.lastSuccess >= config.interval) {
          pollLive(false);
        } else {
          scheduleLive();
        }
      }
      if (state.page === 'animation') resizeAnimation();
    });

    window.addEventListener('online', () => {
      renderNetwork();
      if (state.mode === 'live' && config.activeUrl) pollLive(false);
    });
    window.addEventListener('offline', () => {
      renderNetwork();
      renderStatus();
    });

    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        drawAllSparks();
        if (state.page === 'animation') resizeAnimation();
        if (state.page === 'settings' && state.settingsTab === 'themes') renderThemeGrid();
      }, 140);
    });

    if ('ResizeObserver' in window) {
      const chartObserver = new ResizeObserver(() => {
        if (state.page === 'monitor') drawAllSparks();
      });
      $$('.spark-wrap').forEach((element) => chartObserver.observe(element));
      const stageElement = $('#animStage');
      if (stageElement) {
        const animObserver = new ResizeObserver(() => {
          if (state.page === 'animation') resizeAnimation();
        });
        animObserver.observe(stageElement);
      }
    }
  }

  // ------------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------------
  function boot() {
    applyTheme(state.theme);
    applyStyle(state.style);
    persistenceEnabled = true;
    renderThemeGrid();
    renderSetupPalette();
    buildPomodoro();
    bindEvents();
    updateClock();
    updatePomodoro();
    renderSavedSources();
    renderNetwork();

    setInterval(stepDemo, 1100);
    setInterval(updateClock, 500);
    setInterval(tickPomodoro, 200);
    setInterval(() => {
      renderStatus();
      if (state.monitorView === 'network') renderNetwork();
    }, 1000);

    requestAnimationFrame(animationLoop);

    if (!loaded.hasStored) {
      showSetup();
      return;
    }

    if (config.mode === 'live' && config.activeUrl) {
      showDashboard();
      startLiveState();
      pollLive(false);
    } else if (config.mode === 'demo') {
      setDemoState();
      showDashboard();
    } else {
      showSetup();
    }
  }

  boot();
})();




