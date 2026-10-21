#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <TFT_eSPI.h>
#include <Preferences.h>
#include <WiFiManager.h> // Library Captive Portal WiFi
#include "time.h"

// =========================================================================
//  HARDWARE, DISPLAY, & PWM AUTO-BRIGHTNESS CONFIGURATION (CYD 3.5")
// =========================================================================
#define SCREEN_ROTATION 1    // 1: Landscape, 3: Inverted Landscape
#define INVERT_DISPLAY false // Set true jika warna layar terbalik
#define TFT_BL_PIN 27        // Pin Backlight LCD CYD 3.5"
#define LDR_PIN 34           // Sensor LDR Bawaan CYD
#define BOOT_BTN_PIN 0       // Tombol Fisik BOOT

// PWM Backlight Setup
#define PWM_CHAN 0
#define PWM_FREQ 5000
#define PWM_RES 8 // Resolusi 8-bit (0-255)

TFT_eSPI tft = TFT_eSPI();
TFT_eSprite graphSprite = TFT_eSprite(&tft);
TFT_eSprite dvdSprite = TFT_eSprite(&tft);
bool dvdSpriteReady = false;
const int DVD_W = 70;
const int DVD_H = 32;

// =========================================================================
//  PAGE NAVIGATION & SUB-PAGE STATE
// =========================================================================
#define TOTAL_PAGES 4 // 0: Monitor, 1: Clock, 2: Animation, 3: Settings

volatile int currentPage = 0;
int monitorSubPage = 0; // 0: HW Monitor (CPU/GPU/RAM), 1: WiFi Diagnostic Hub
int clockSubPage = 0;   // 0: Clock, 1: Pomodoro Mode
bool forceSubPageRefresh = false;

bool lastBtnState = HIGH;
unsigned long lastBtnPress = 0;

// Touch State
bool touchPressed = false;
unsigned long lastTouchTime = 0;
uint16_t touchStartX = 0;
uint16_t touchStartY = 0;

// Settings Page Tabs & Theme Paging
int settingsTab = 0; // 0 = saved networks, 1 = themes
bool isDraggingSettings = false;
uint16_t lastTouchY = 0;
unsigned long touchStartMillis = 0;
bool longPressFired = false;

// =========================================================================
//  PING TARGETS CONFIGURATION
// =========================================================================
struct PingTarget {
  const char* name;
  const char* host;
  uint16_t port;
};

const PingTarget PING_TARGETS[] = {
  {"GOOGLE (8.8.8.8)", "8.8.8.8", 53},
  {"CLOUDFLARE (1.1.1.1)", "1.1.1.1", 80},
  {"TELKOM (180.250.250.250)", "180.250.250.250", 53}
};
int currentPingTargetIdx = 0;
const int TOTAL_PING_TARGETS = 3;

// =========================================================================
//  POMODORO TIMER STATE
// =========================================================================
bool pomodoroActive = false;
bool pomodoroPaused = false;
bool pomodoroFinished = false;
int pomodoroMinutes = 25;
int pomodoroSessionsCompleted = 0;
unsigned long pomodoroEndMillis = 0;
unsigned long pomodoroRemainingMs = 0;
unsigned long pomodoroDurationMs = 0;
unsigned long pomodoroBlinkStart = 0;

// =========================================================================
//  SAVED NETWORKS & DATA SOURCE
//  Every saved Wi-Fi profile also remembers the LibreHardwareMonitor URL
//  that belongs to that network, so switching networks switches the source.
// =========================================================================
#define MAX_WIFI_PROFILES 6
#define WIFI_AP_SSID "CYD-MONITOR-AP"
#define WIFI_AP_PASS "password123"

struct WifiProfile
{
  String ssid;
  String pass;
  String url;
};

WifiProfile wifiProfiles[MAX_WIFI_PROFILES];
int wifiProfileCount = 0;
int activeProfile = -1;
volatile bool networkBusy = false;

char serverUrl[128] = "http://192.168.1.50:8085/data.json";
SemaphoreHandle_t configMutex = NULL;

const char *ntpServer = "pool.ntp.org";
const long gmtOffset_sec = 7 * 3600; // WIB (GMT+7)
const int daylightOffset_sec = 0;

// =========================================================================
//  LIVE HARDWARE SNAPSHOT
//  Filled by walking whatever hardware tree LibreHardwareMonitor exposes,
//  so AMD / Intel / NVIDIA and desktop / laptop all work without edits.
// =========================================================================
struct LiveData
{
  char cpuName[44] = "CPU";
  char gpuName[44] = "GPU";

  float cpuTemp = 0.0f, cpuLoad = 0.0f, cpuPower = 0.0f;
  int cpuFan = 0;
  bool cpuHasTemp = false;

  float gpuTemp = 0.0f, gpuHot = 0.0f, gpuLoad = 0.0f;
  float gpuMemUsed = 0.0f, gpuMemTotal = 0.0f;
  bool gpuHasTemp = false, gpuHasHotspot = false, gpuHasMem = false;

  float ramLoad = 0.0f, ramUsed = 0.0f, ramTotal = 0.0f;
  bool ramValid = false;
  bool valid = false;
};

LiveData liveData;
SemaphoreHandle_t dataMutex = NULL;

TaskHandle_t httpTaskHandle = NULL;
volatile unsigned long lastSuccessFetch = 0;
volatile bool dataUpdated = false;
volatile int lastHttpCode = 0;
volatile int lastJsonError = 0;
volatile uint32_t lastFetchHeap = 0;
volatile bool lastSensorFound = false;

Preferences prefs;

// Defined later, declared here for the HTTP task and UI.
String getServerUrl();
void setServerUrl(const String &url);
void resetTelemetry();

// =========================================================================
//  THEME SYSTEM (15 Themes)
// =========================================================================
struct ThemePalette
{
  uint16_t bg, cardBg, cardBorder, headerBg, barTrack;
  uint16_t textWhite, textMuted, textDark;
  uint16_t tempCool, tempWarm, tempHot;
  uint16_t accent1, accent2, accent3, gold;
  const char *name;
};

const ThemePalette THEME_DUOTONE = {0x0841, 0x1082, 0x39E7, 0x0841, 0x2945, 0xFFFF, 0xAD75, 0x528A, 0x051F, 0xFD20, 0xF800, 0x051F, 0xFC40, 0x051F, 0xFC40, "DUO-TONE"};
const ThemePalette THEME_EINK = {0xF7BE, 0xCE59, 0x4208, 0xDF1C, 0xD69A, 0x4A49, 0x4208, 0x8410, 0x4208, 0x2104, 0x4A49, 0x4A49, 0x31A6, 0x630C, 0x9492, "E-INK"};
const ThemePalette THEME_EMERALD = {0x0183, 0x0A26, 0x1B8A, 0x0102, 0x0A47, 0xEFEF, 0x7E31, 0x33A6, 0x07E0, 0xFDE0, 0xF9A0, 0x07E0, 0x07EF, 0x366B, 0xFFE0, "EMERALD"};
const ThemePalette THEME_DRACULA = {0x280D, 0x3852, 0x6277, 0x200A, 0x4896, 0xF79E, 0x9E3B, 0x5291, 0x57FF, 0xFAAA, 0xF888, 0xFAAA, 0x57FF, 0xAF7D, 0xFEA0, "DRACULA"};
const ThemePalette THEME_OCEAN = {0x000B, 0x016E, 0x0375, 0x0007, 0x0272, 0xE7FF, 0x74FE, 0x33B3, 0x07FF, 0x05BD, 0xF9E7, 0x07FF, 0x041F, 0x367F, 0x7FFF, "DEEP OCEAN"};
const ThemePalette THEME_SUNSET = {0x1805, 0x2809, 0x590E, 0x1003, 0x386A, 0xFFFE, 0xD4B3, 0x72AA, 0xFE20, 0xFD20, 0xF800, 0xFC40, 0xF814, 0xFD60, 0xFFE0, "SUNSET"};
const ThemePalette THEME_SOLAR = {0x002B, 0x086E, 0x2A73, 0x0027, 0x18B0, 0x94B2, 0x5395, 0x2A73, 0x2C40, 0xB400, 0xD800, 0x2B8F, 0xB400, 0x2C40, 0xCB20, "SOLARIZED"};
const ThemePalette THEME_AMBER = {0x0000, 0x1080, 0x4200, 0x0800, 0x2100, 0xFFE0, 0xC400, 0x6200, 0xFF40, 0xFD20, 0xF800, 0xFFE0, 0xFC00, 0xD400, 0xFFE0, "AMBER CRT"};
const ThemePalette THEME_MATRIX = {0x0000, 0x0100, 0x0380, 0x0080, 0x0200, 0x07E0, 0x04A0, 0x0280, 0x07E0, 0xAFE0, 0xF800, 0x07E0, 0x37E0, 0x05E0, 0xB7E0, "NEON MATRIX"};
const ThemePalette THEME_MIDNIGHT = {0x0000, 0x1002, 0x3809, 0x0801, 0x2005, 0xFFFF, 0x9013, 0x400A, 0x901F, 0xF80F, 0xF800, 0xC81F, 0xF80F, 0x601F, 0xFBC0, "MIDNIGHT"};
const ThemePalette THEME_CRIMSON = {0x1800, 0x3000, 0x8000, 0x2000, 0x4000, 0xFFFF, 0xD510, 0x6000, 0x07E0, 0xFD20, 0xF800, 0xDC07, 0xF800, 0xFC00, 0xFFE0, "CRIMSON RED"};
const ThemePalette THEME_MAROON = {0x1000, 0x2802, 0x6004, 0x1801, 0x4002, 0xFFFB, 0xB3E7, 0x5001, 0x07E0, 0xFD20, 0xF800, 0x8000, 0xA002, 0xD005, 0xFEA0, "DEEP MAROON"};
const ThemePalette THEME_CYBER_RED = {0x0000, 0x1000, 0xF800, 0x0800, 0x3000, 0xFFFF, 0xF9E7, 0x6000, 0x07E0, 0xFD20, 0xF800, 0xFA4B, 0xF800, 0xFC00, 0xFFE0, "CYBER RED"};
const ThemePalette THEME_RUBY = {0x1002, 0x2805, 0x7809, 0x1803, 0x3807, 0xFFFE, 0xC3B2, 0x5003, 0x07E0, 0xFD20, 0xF800, 0x9805, 0xC008, 0xE80A, 0xFD60, "RUBY WINE"};
const ThemePalette THEME_VERMILION = {0x1800, 0x2880, 0x7A00, 0x2000, 0x4100, 0xFFFF, 0xDC05, 0x5800, 0x07E0, 0xFD20, 0xF800, 0xE206, 0xF9A0, 0xFB00, 0xFFE0, "VERMILION"};

ThemePalette T = THEME_DUOTONE;
int selectedTheme = 0;
const int TOTAL_THEMES = 15;
const ThemePalette *ALL_THEMES[TOTAL_THEMES] = {
    &THEME_DUOTONE, &THEME_EINK, &THEME_EMERALD, &THEME_DRACULA, &THEME_OCEAN,
    &THEME_SUNSET, &THEME_SOLAR, &THEME_AMBER, &THEME_MATRIX, &THEME_MIDNIGHT,
    &THEME_CRIMSON, &THEME_MAROON, &THEME_CYBER_RED, &THEME_RUBY, &THEME_VERMILION};

// Theme browser: six fully visible cards per page (3 rows x 2 columns).
const int THEME_COLS = 2;
const int THEME_ROWS = 3;
const int THEME_PAGE_SIZE = THEME_COLS * THEME_ROWS;
const int THEME_PAGES = (TOTAL_THEMES + THEME_PAGE_SIZE - 1) / THEME_PAGE_SIZE;
int themePage = 0;

// =========================================================================
//  DATA BUFFERS
// =========================================================================
#define HISTORY_LEN 40
float cpuHistory[HISTORY_LEN];
float gpuHistory[HISTORY_LEN];
int historyCount = 0;

// =========================================================================
//  ANIMATION PAGE STATE
// =========================================================================
int currentAnim = 0;
const int TOTAL_ANIMS = 3;
const char *animNames[3] = {"MATRIX RAIN", "STARFIELD 3D", "BOUNCING DVD"};

#define MATRIX_COLS 28
#define MATRIX_TOP 44
#define MATRIX_BOTTOM 278
#define MATRIX_CELL 12
#define MATRIX_TRAIL 5
float matrixY[MATRIX_COLS];
int matrixSpeed[MATRIX_COLS];

#define NUM_STARS 50
struct Star
{
  float x, y, z;
};
Star stars[NUM_STARS];

int dvdX = 100, dvdY = 100, dvdVX = 1, dvdVY = 1;
float dvdAccumX = 0.0f, dvdAccumY = 0.0f;
const float DVD_SPEED_X = 180.0f;
const float DVD_SPEED_Y = 120.0f;
uint16_t dvdColor = 0x07FF;

unsigned long animFrameCount = 0, lastFpsTime = 0, lastAnimUpdate = 0;
float measuredFps = 60.0;

// Forward Declarations
void drawHeaderTabs();
void updateHeaderWifi();
void drawMonitorPage();
void updateMonitorData();
void drawClockPage();
void updateClockPage(bool secondChanged = true);
void initAnimation();
void renderAnimationFrame();
void drawSettingsPage();
void drawSettingsContent();
void applyTheme(int themeIndex);
void switchPage(int newPage);

// =========================================================================
//  AUTO BRIGHTNESS CONTROLLER (PWM)
// =========================================================================
void setupAutoBrightness()
{
  pinMode(LDR_PIN, INPUT);
  ledcSetup(PWM_CHAN, PWM_FREQ, PWM_RES);
  ledcAttachPin(TFT_BL_PIN, PWM_CHAN);
  ledcWrite(PWM_CHAN, 180);
}

void updateAutoBrightness()
{
  static unsigned long lastLdrCheck = 0;
  if (millis() - lastLdrCheck < 80)
    return;
  lastLdrCheck = millis();

  static float smoothedLdr = 2000.0;
  int rawLdr = analogRead(LDR_PIN);

  smoothedLdr = (smoothedLdr * 0.93) + (rawLdr * 0.07);
  int brightness = map((int)smoothedLdr, 0, 4095, 15, 255);
  brightness = constrain(brightness, 15, 255);

  ledcWrite(PWM_CHAN, brightness);
}

// =========================================================================
//  NON-BLOCKING LATENCY MEASUREMENT HELPER (250ms Max Timeout)
// =========================================================================
long measureLatency(const char* host, uint16_t port = 80) {
  if (WiFi.status() != WL_CONNECTED) return -1;
  unsigned long start = millis();
  WiFiClient client;
  // Gunakan connection timeout eksplisit 250ms agar tidak memblokir loop
  if (client.connect(host, port, 250)) {
    long lat = millis() - start;
    client.stop();
    return lat;
  }
  return -1;
}

// =========================================================================
//  THEME APPLICATION
// =========================================================================
void applyTheme(int themeIndex)
{
  if (themeIndex < 0 || themeIndex >= TOTAL_THEMES)
    themeIndex = 0;
  selectedTheme = themeIndex;
  T = *ALL_THEMES[selectedTheme];
  prefs.putInt("theme", selectedTheme);
}

// =========================================================================
//  ADAPTIVE SENSOR DISCOVERY
//  Walks the LibreHardwareMonitor tree once and matches by hardware id,
//  sensor type and label instead of hard-coded motherboard-specific ids.
// =========================================================================
enum HardwareKind : uint8_t
{
  HW_OTHER = 0,
  HW_CPU,
  HW_GPU,
  HW_RAM
};

bool icontains(const char *haystack, const char *needle)
{
  if (!haystack || !needle || !needle[0])
    return false;
  size_t needleLen = strlen(needle);
  for (const char *p = haystack; *p; ++p)
  {
    size_t i = 0;
    while (i < needleLen && p[i] &&
           tolower((unsigned char)p[i]) == tolower((unsigned char)needle[i]))
      i++;
    if (i == needleLen)
      return true;
  }
  return false;
}

float parseSensorValue(const char *text)
{
  if (!text)
    return 0.0f;
  char buffer[20];
  int n = 0;
  bool started = false;
  for (const char *p = text; *p && n < 19; ++p)
  {
    if ((*p >= '0' && *p <= '9') || *p == '-' || *p == '+' || *p == '.')
    {
      buffer[n++] = *p;
      started = true;
    }
    else if (*p == ',' && started)
    {
      buffer[n++] = '.';
    }
    else if (started)
    {
      break;
    }
  }
  buffer[n] = '\0';
  return n > 0 ? (float)atof(buffer) : 0.0f;
}

void stripSuffix(String &value, const char *suffix)
{
  int pos = value.indexOf(suffix);
  if (pos > 0)
    value.remove(pos);
}

void shortCpuName(const char *raw, char *out, size_t outSize)
{
  String name((raw && raw[0]) ? raw : "CPU");
  name.replace("(R)", "");
  name.replace("(TM)", "");
  name.trim();

  const char *suffixes[] = {
      " with Radeon Graphics",
      " with Radeon Vega Graphics",
      " 64-Core Processor",
      " 32-Core Processor",
      " 24-Core Processor",
      " 16-Core Processor",
      " 12-Core Processor",
      " 10-Core Processor",
      " 8-Core Processor",
      " 6-Core Processor",
      " 4-Core Processor",
      " 2-Core Processor",
      " Processor",
      " CPU"};
  for (const char *suffix : suffixes)
    stripSuffix(name, suffix);

  name.trim();
  if (!name.length())
    name = "CPU";
  strlcpy(out, name.c_str(), outSize);
}

void shortGpuName(const char *raw, char *out, size_t outSize)
{
  String name((raw && raw[0]) ? raw : "GPU");
  name.replace("(R)", "");
  name.replace("(TM)", "");
  name.trim();

  if (name.startsWith("AMD Radeon RX "))
  {
    name = "RX " + name.substring(14);
  }
  else if (name.startsWith("AMD Radeon "))
  {
    String rest = name.substring(11);
    name = (rest == "Graphics") ? "Radeon Graphics" : rest;
  }
  else if (name.startsWith("AMD "))
  {
    name.remove(0, 4);
  }
  else if (name.startsWith("NVIDIA GeForce "))
  {
    name.remove(0, 15);
  }
  else if (name.startsWith("NVIDIA "))
  {
    name.remove(0, 7);
  }
  else if (name.startsWith("Intel "))
  {
    name.remove(0, 6);
  }

  name.trim();
  if (!name.length())
    name = "GPU";
  strlcpy(out, name.c_str(), outSize);
}

HardwareKind classifyHardware(const char *hardwareId)
{
  if (!hardwareId)
    return HW_OTHER;
  if (!strncmp(hardwareId, "/amdcpu", 7) ||
      !strncmp(hardwareId, "/intelcpu", 9) ||
      !strncmp(hardwareId, "/cpu", 4))
    return HW_CPU;
  if (!strncmp(hardwareId, "/gpu", 4))
    return HW_GPU;
  if (!strncmp(hardwareId, "/ram", 4))
    return HW_RAM;
  return HW_OTHER;
}

struct GpuCandidate
{
  char name[44] = "GPU";
  float temp = 0.0f, hot = 0.0f, load = 0.0f;
  float memUsed = 0.0f, memTotal = 0.0f;
  bool hasTemp = false, hasHot = false, hasLoad = false, hasMem = false;
  int tempScore = 0, hotScore = 0, loadScore = 0, memScore = 0;
};

struct ScanResult
{
  LiveData data;
  GpuCandidate gpus[3];
  int gpuCount = 0;
  int cpuTempScore = 0, cpuLoadScore = 0, cpuPowerScore = 0, cpuFanScore = 0;
  float ramAvailable = 0.0f;
};

void scanSensorNode(JsonVariant node, HardwareKind kind, int gpuIdx, ScanResult &scan)
{
  if (!node.is<JsonObject>())
    return;
  JsonObject obj = node.as<JsonObject>();

  JsonVariant hwVar = obj["HardwareId"];
  if (hwVar.is<const char *>())
  {
    kind = classifyHardware(hwVar.as<const char *>());
    const char *hwText = obj["Text"] | "";

    if (kind == HW_CPU)
    {
      shortCpuName(hwText, scan.data.cpuName, sizeof(scan.data.cpuName));
    }
    else if (kind == HW_GPU)
    {
      if (scan.gpuCount < 3)
      {
        gpuIdx = scan.gpuCount++;
        shortGpuName(hwText, scan.gpus[gpuIdx].name, sizeof(scan.gpus[gpuIdx].name));
      }
      else
      {
        gpuIdx = -1;
      }
    }
  }

  JsonVariant sidVar = obj["SensorId"];
  if (sidVar.is<const char *>())
  {
    const char *sensorId = sidVar.as<const char *>();
    const char *type = obj["Type"] | "";
    const char *text = obj["Text"] | "";
    float value = parseSensorValue(obj["Value"] | "");

    if (sensorId[0])
    {
      if (kind == HW_CPU)
      {
        if (!strcmp(type, "Temperature"))
        {
          int score = 10;
          if (icontains(text, "tctl") || icontains(text, "tdie"))
            score = 100;
          else if (icontains(text, "package"))
            score = 90;
          else if (icontains(text, "cpu"))
            score = 50;

          if (!scan.data.cpuHasTemp || score > scan.cpuTempScore)
          {
            scan.data.cpuTemp = value;
            scan.data.cpuHasTemp = true;
            scan.cpuTempScore = score;
          }
        }
        else if (!strcmp(type, "Load"))
        {
          int score = icontains(text, "total") ? 100 : 10;
          if (score > scan.cpuLoadScore)
          {
            scan.data.cpuLoad = value;
            scan.cpuLoadScore = score;
          }
        }
        else if (!strcmp(type, "Power"))
        {
          int score = icontains(text, "package") ? 100 : (icontains(text, "cpu") ? 50 : 10);
          if (score > scan.cpuPowerScore)
          {
            scan.data.cpuPower = value;
            scan.cpuPowerScore = score;
          }
        }
      }
      else if (kind == HW_GPU && gpuIdx >= 0 && gpuIdx < scan.gpuCount)
      {
        GpuCandidate &gpu = scan.gpus[gpuIdx];

        if (!strcmp(type, "Temperature"))
        {
          if (icontains(text, "hot spot") || icontains(text, "hotspot") ||
              icontains(text, "junction"))
          {
            int score = 100;
            if (!gpu.hasHot || score > gpu.hotScore)
            {
              gpu.hot = value;
              gpu.hasHot = true;
              gpu.hotScore = score;
            }
          }
          else
          {
            int score = 10;
            if (icontains(text, "gpu core"))
              score = 100;
            else if (icontains(text, "core"))
              score = 80;
            else if (icontains(text, "edge"))
              score = 70;
            else if (icontains(text, "gpu"))
              score = 60;

            if (!gpu.hasTemp || score > gpu.tempScore)
            {
              gpu.temp = value;
              gpu.hasTemp = true;
              gpu.tempScore = score;
            }
          }
        }
        else if (!strcmp(type, "Load"))
        {
          int score = 10;
          if (icontains(text, "gpu core"))
            score = 100;
          else if (icontains(text, "d3d 3d"))
            score = 80;
          else if (icontains(text, "core"))
            score = 60;

          if (!gpu.hasLoad || score > gpu.loadScore)
          {
            gpu.load = value;
            gpu.hasLoad = true;
            gpu.loadScore = score;
          }
        }
        else if (!strcmp(type, "SmallData") || !strcmp(type, "Data"))
        {
          bool used = icontains(text, "used");
          bool total = icontains(text, "total");
          if (used || total)
          {
            int score = 10;
            if (icontains(text, "gpu memory"))
              score = 100;
            else if (icontains(text, "d3d") && icontains(text, "dedicated"))
              score = 90;
            else if (icontains(text, "memory"))
              score = 50;

            if (used && (!gpu.hasMem || score > gpu.memScore))
            {
              gpu.memUsed = value;
              gpu.hasMem = true;
              gpu.memScore = score;
            }
            else if (total)
            {
              gpu.memTotal = value;
            }
          }
        }
      }
      else if (kind == HW_RAM)
      {
        // LibreHardwareMonitor also exposes "Virtual Memory" sensors after the
        // physical memory ones. Keep the physical values for the RAM card.
        if (icontains(text, "virtual"))
        {
          // skip
        }
        else if (!strcmp(type, "Load"))
        {
          scan.data.ramLoad = value;
        }
        else if (!strcmp(type, "Data"))
        {
          if (icontains(text, "used"))
            scan.data.ramUsed = value;
          else if (icontains(text, "available") || icontains(text, "free"))
            scan.ramAvailable = value;
        }
      }

      // Fans are usually attached to the Super I/O chip, not the CPU node.
      if (!strcmp(type, "Fan"))
      {
        int score = icontains(text, "cpu") ? 100 : (icontains(text, "fan") ? 20 : 10);
        if (score > scan.cpuFanScore)
        {
          scan.data.cpuFan = (int)value;
          scan.cpuFanScore = score;
        }
      }
    }
  }

  JsonVariant childrenVar = obj["Children"];
  if (childrenVar.is<JsonArray>())
  {
    for (JsonVariant child : childrenVar.as<JsonArray>())
      scanSensorNode(child, kind, gpuIdx, scan);
  }
}

int gpuCandidateScore(const GpuCandidate &gpu)
{
  int score = 0;
  if (gpu.hasTemp)
    score += 100;
  if (gpu.hasHot)
    score += 40;
  if (gpu.hasLoad)
    score += 10;
  if (gpu.hasMem)
    score += 5;
  if (icontains(gpu.name, "rtx") || icontains(gpu.name, "gtx") ||
      icontains(gpu.name, "rx ") || icontains(gpu.name, "arc "))
    score += 30;
  return score;
}

void finalizeScan(ScanResult &scan)
{
  if (scan.data.ramUsed > 0.0f && scan.ramAvailable > 0.0f)
  {
    scan.data.ramTotal = scan.data.ramUsed + scan.ramAvailable;
    scan.data.ramValid = true;
  }

  int best = -1, bestScore = -1;
  for (int i = 0; i < scan.gpuCount; i++)
  {
    int score = gpuCandidateScore(scan.gpus[i]);
    if (score > bestScore)
    {
      bestScore = score;
      best = i;
    }
  }

  if (best >= 0)
  {
    GpuCandidate &gpu = scan.gpus[best];
    strlcpy(scan.data.gpuName, gpu.name, sizeof(scan.data.gpuName));
    scan.data.gpuTemp = gpu.temp;
    scan.data.gpuHot = gpu.hot;
    scan.data.gpuLoad = gpu.load;
    scan.data.gpuMemUsed = gpu.memUsed;
    scan.data.gpuMemTotal = gpu.memTotal;
    scan.data.gpuHasTemp = gpu.hasTemp && gpu.temp > 0.0f;
    scan.data.gpuHasHotspot = gpu.hasHot && gpu.hot > 0.0f;
    scan.data.gpuHasMem = gpu.hasMem && gpu.memUsed > 0.0f;
  }

  bool gpuHasData = best >= 0 &&
                    (scan.gpus[best].hasTemp || scan.gpus[best].hasLoad || scan.gpus[best].hasMem);
  scan.data.valid = scan.data.cpuHasTemp || scan.cpuLoadScore > 0 ||
                    scan.cpuPowerScore > 0 || scan.cpuFanScore > 0 ||
                    scan.data.ramValid || gpuHasData;
}

void commitLiveData(const LiveData &next)
{
  if (dataMutex)
  {
    xSemaphoreTake(dataMutex, portMAX_DELAY);
    liveData = next;
    xSemaphoreGive(dataMutex);
  }
  else
  {
    liveData = next;
  }
}

LiveData snapshotLiveData()
{
  LiveData copy;
  if (dataMutex)
  {
    xSemaphoreTake(dataMutex, portMAX_DELAY);
    copy = liveData;
    xSemaphoreGive(dataMutex);
  }
  else
  {
    copy = liveData;
  }
  return copy;
}

void pushHistory(float *arr, float val)
{
  if (val <= 0.0)
    return;
  for (int i = 0; i < HISTORY_LEN - 1; i++)
    arr[i] = arr[i + 1];
  arr[HISTORY_LEN - 1] = val;
  if (historyCount < HISTORY_LEN)
    historyCount++;
}

float getTrendDelta(float *history)
{
  if (historyCount < 2)
    return 0.0;
  return (history[HISTORY_LEN - 1] - history[HISTORY_LEN - 2]);
}

uint16_t getTempColor(float temp)
{
  if (temp <= 0.0)
    return T.textMuted;
  if (temp < 55.0)
    return T.tempCool;
  if (temp < 75.0)
    return T.tempWarm;
  return T.tempHot;
}

uint16_t getUsageColor(float pct)
{
  if (pct < 60.0)
    return T.tempCool;
  if (pct < 85.0)
    return T.tempWarm;
  return T.tempHot;
}

void drawUnit(int x, int y, bool isTemperature, uint16_t color, uint16_t bgColor)
{
  tft.setTextPadding(0);
  tft.setTextFont(4);
  tft.setTextColor(color, bgColor);
  tft.setTextDatum(TL_DATUM);
  if (isTemperature)
  {
    tft.drawCircle(x + 3, y + 4, 3, color);
    tft.drawCircle(x + 3, y + 4, 2, color);
    tft.drawString("C", x + 9, y);
  }
  else
  {
    tft.drawString("%", x + 2, y);
  }
}

String fitText(const String &text, int maxWidth, uint8_t font)
{
  if (maxWidth <= 0)
    return "";
  if (tft.textWidth(text, font) <= maxWidth)
    return text;

  String fitted = text;
  while (fitted.length() > 0 && tft.textWidth(fitted + "..", font) > maxWidth)
    fitted.remove(fitted.length() - 1);
  return fitted + "..";
}

void drawRightText(const String &text, int rightX, int y, uint8_t font,
                   uint16_t color, uint16_t bgColor)
{
  tft.setTextDatum(TL_DATUM);
  tft.setTextFont(font);
  tft.setTextColor(color, bgColor);
  int width = tft.textWidth(text, font);
  tft.drawString(text, rightX - width, y, font);
}

void drawNameText(int x, int y, int maxWidth, const char *name)
{
  String fitted = fitText(String(name), maxWidth, 1);
  tft.setTextDatum(TL_DATUM);
  tft.setTextFont(1);
  tft.setTextColor(T.textMuted, T.cardBg);
  tft.drawString(fitted, x, y);
}

// drawCentreString() in TFT_eSPI is top-centre (TC_DATUM), not middle-centre.
// Use this helper when the supplied y is meant to be the vertical centre.
void drawCenteredText(const char *text, int x, int y, uint8_t font)
{
  uint8_t previous = tft.getTextDatum();
  tft.setTextDatum(MC_DATUM);
  tft.drawString(text, x, y, font);
  tft.setTextDatum(previous);
}

void drawFeedStatus(int x, int y)
{
  char status[96];
  bool waiting = (lastSuccessFetch == 0);

  if (waiting && lastHttpCode == 0)
    snprintf(status, sizeof(status), "DATA: WAITING FOR FIRST FETCH");
  else if (waiting && lastHttpCode > 0 && lastJsonError == 0 && !lastSensorFound)
    snprintf(status, sizeof(status), "DATA: NO SENSORS  HTTP %d  HEAP %uK",
             (int)lastHttpCode, (unsigned)(lastFetchHeap / 1024));
  else if (waiting && lastHttpCode > 0)
    snprintf(status, sizeof(status), "DATA: HTTP %d  JSON %d  HEAP %uK",
             (int)lastHttpCode, (int)lastJsonError, (unsigned)(lastFetchHeap / 1024));
  else if (waiting)
    snprintf(status, sizeof(status), "DATA: CONNECT ERR %d  HEAP %uK",
             (int)lastHttpCode, (unsigned)(lastFetchHeap / 1024));
  else
  {
    bool stale = (millis() - lastSuccessFetch > 10000UL);
    snprintf(status, sizeof(status), "DATA: %s  HTTP %d  JSON %d  HEAP %uK",
             stale ? "STALE" : "OK", (int)lastHttpCode,
             (int)lastJsonError, (unsigned)(lastFetchHeap / 1024));
  }

  tft.setTextDatum(TL_DATUM);
  tft.setTextFont(1);
  tft.setTextColor(waiting ? T.tempWarm : T.textMuted, T.cardBg);
  tft.drawString(fitText(String(status), 296, 1), x, y);
}

void drawGpuHotspot(const LiveData &data)
{
  uint16_t bg = (data.gpuHot >= 85.0f) ? T.tempHot : T.cardBorder;
  tft.fillRoundRect(368, 43, 96, 18, 4, bg);
  char text[20];
  snprintf(text, sizeof(text), "HOT: %.1fC", data.gpuHot);
  tft.setTextFont(1);
  tft.setTextColor((data.gpuHot >= 85.0f) ? T.textWhite : T.gold, bg);
  drawCenteredText(text, 416, 52, 1);
}

void drawTrendBadge(int x, int y, float delta, uint16_t bgColor)
{
  tft.fillRect(x, y, 76, 18, bgColor);
  if (delta > 0.3)
  {
    tft.fillTriangle(x + 2, y + 12, x + 7, y + 3, x + 12, y + 12, T.tempWarm);
    tft.setTextFont(2);
    tft.setTextColor(T.tempWarm, bgColor);
    tft.setCursor(x + 16, y);
    tft.printf("+%.1f", delta);
  }
  else if (delta < -0.3)
  {
    tft.fillTriangle(x + 2, y + 3, x + 7, y + 12, x + 12, y + 3, T.tempCool);
    tft.setTextFont(2);
    tft.setTextColor(T.tempCool, bgColor);
    tft.setCursor(x + 16, y);
    tft.printf("-%.1f", abs(delta));
  }
  else
  {
    tft.fillRect(x + 2, y + 8, 8, 2, T.textMuted);
    tft.setTextFont(1);
    tft.setTextColor(T.textMuted, bgColor);
    tft.drawString("STABLE", x + 14, y + 3);
  }
}

void drawMiniBar(int x, int y, int w, int h, float val, float maxVal, uint16_t color)
{
  tft.fillRect(x, y, w, h, T.barTrack);
  int fillW = (int)((val / maxVal) * (float)w);
  fillW = constrain(fillW, 0, w);
  if (fillW > 0)
    tft.fillRect(x, y, fillW, h, color);
}

// =========================================================================
//  WIFI PROFILE STORAGE & CONNECTION MANAGEMENT
// =========================================================================
String getServerUrl()
{
  String value;
  if (configMutex)
  {
    xSemaphoreTake(configMutex, portMAX_DELAY);
    value = serverUrl;
    xSemaphoreGive(configMutex);
  }
  else
  {
    value = serverUrl;
  }
  return value;
}

void setServerUrl(const String &url)
{
  String normalized = url;
  normalized.trim();
  if (!normalized.length())
    return;
  if (!normalized.startsWith("http://") && !normalized.startsWith("https://"))
    normalized = "http://" + normalized;

  if (configMutex)
  {
    xSemaphoreTake(configMutex, portMAX_DELAY);
    normalized.toCharArray(serverUrl, sizeof(serverUrl));
    xSemaphoreGive(configMutex);
  }
  else
  {
    normalized.toCharArray(serverUrl, sizeof(serverUrl));
  }
  prefs.putString("server_url", normalized);
}

void loadWifiProfiles()
{
  WifiProfile loaded[MAX_WIFI_PROFILES];
  int stored = prefs.getInt("net_n", 0);
  int kept = 0;

  for (int i = 0; i < stored && i < MAX_WIFI_PROFILES; i++)
  {
    char key[12];
    snprintf(key, sizeof(key), "n%ds", i);
    String ssid = prefs.getString(key, "");
    if (!ssid.length())
      continue;
    snprintf(key, sizeof(key), "n%dp", i);
    String pass = prefs.getString(key, "");
    snprintf(key, sizeof(key), "n%du", i);
    String url = prefs.getString(key, "");

    loaded[kept].ssid = ssid;
    loaded[kept].pass = pass;
    loaded[kept].url = url;
    kept++;
  }

  wifiProfileCount = kept;
  for (int i = 0; i < kept; i++)
    wifiProfiles[i] = loaded[i];
  for (int i = kept; i < MAX_WIFI_PROFILES; i++)
    wifiProfiles[i] = WifiProfile();
}

void saveWifiProfiles()
{
  prefs.putInt("net_n", wifiProfileCount);
  for (int i = 0; i < MAX_WIFI_PROFILES; i++)
  {
    char key[12];
    if (i < wifiProfileCount)
    {
      snprintf(key, sizeof(key), "n%ds", i);
      prefs.putString(key, wifiProfiles[i].ssid);
      snprintf(key, sizeof(key), "n%dp", i);
      prefs.putString(key, wifiProfiles[i].pass);
      snprintf(key, sizeof(key), "n%du", i);
      prefs.putString(key, wifiProfiles[i].url);
    }
    else
    {
      snprintf(key, sizeof(key), "n%ds", i);
      prefs.remove(key);
      snprintf(key, sizeof(key), "n%dp", i);
      prefs.remove(key);
      snprintf(key, sizeof(key), "n%du", i);
      prefs.remove(key);
    }
  }
}

int findWifiProfile(const String &ssid)
{
  for (int i = 0; i < wifiProfileCount; i++)
  {
    if (wifiProfiles[i].ssid == ssid)
      return i;
  }
  return -1;
}

int upsertWifiProfile(const String &ssid, const String &pass, const String &url)
{
  if (!ssid.length())
    return -1;

  int idx = findWifiProfile(ssid);
  if (idx < 0)
  {
    if (wifiProfileCount < MAX_WIFI_PROFILES)
    {
      idx = wifiProfileCount++;
    }
    else
    {
      for (int i = 1; i < MAX_WIFI_PROFILES; i++)
        wifiProfiles[i - 1] = wifiProfiles[i];
      idx = MAX_WIFI_PROFILES - 1;
    }
  }

  wifiProfiles[idx].ssid = ssid;
  if (pass.length())
    wifiProfiles[idx].pass = pass;
  if (url.length())
    wifiProfiles[idx].url = url;
  if (!wifiProfiles[idx].url.length())
    wifiProfiles[idx].url = getServerUrl();

  saveWifiProfiles();
  return idx;
}

void removeWifiProfile(int idx)
{
  if (idx < 0 || idx >= wifiProfileCount)
    return;

  for (int i = idx; i < wifiProfileCount - 1; i++)
    wifiProfiles[i] = wifiProfiles[i + 1];
  wifiProfiles[wifiProfileCount - 1] = WifiProfile();
  wifiProfileCount--;

  if (activeProfile == idx)
    activeProfile = -1;
  else if (activeProfile > idx)
    activeProfile--;

  saveWifiProfiles();
  prefs.putInt("net_last", activeProfile);
}

void resetTelemetry()
{
  LiveData empty;
  commitLiveData(empty);
  for (int i = 0; i < HISTORY_LEN; i++)
  {
    cpuHistory[i] = 0.0f;
    gpuHistory[i] = 0.0f;
  }
  historyCount = 0;
  lastSuccessFetch = 0;
  lastHttpCode = 0;
  lastJsonError = 0;
  lastFetchHeap = 0;
  lastSensorFound = false;
  dataUpdated = true;
}

bool waitForWifi(unsigned long timeoutMs)
{
  unsigned long start = millis();
  while (millis() - start < timeoutMs)
  {
    if (WiFi.status() == WL_CONNECTED)
      return true;
    delay(100);
  }
  return WiFi.status() == WL_CONNECTED;
}

bool connectProfile(int idx, unsigned long timeoutMs)
{
  if (idx < 0 || idx >= wifiProfileCount)
    return false;

  WifiProfile &profile = wifiProfiles[idx];

  if (WiFi.status() == WL_CONNECTED && WiFi.SSID() == profile.ssid)
  {
    activeProfile = idx;
    if (profile.url.length())
      setServerUrl(profile.url);
    prefs.putInt("net_last", idx);
    return true;
  }

  networkBusy = true;
  WiFi.disconnect(false, false);
  delay(120);
  WiFi.begin(profile.ssid.c_str(), profile.pass.c_str());

  bool connected = waitForWifi(timeoutMs);
  if (connected)
  {
    activeProfile = idx;
    if (profile.url.length())
      setServerUrl(profile.url);
    prefs.putInt("net_last", idx);
    configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
    resetTelemetry();
  }
  else
  {
    WiFi.disconnect(false, false);
  }

  networkBusy = false;
  return connected;
}

bool connectToAnySavedNetwork()
{
  if (wifiProfileCount == 0)
    return false;

  int last = prefs.getInt("net_last", -1);
  if (last >= 0 && last < wifiProfileCount && connectProfile(last, 8000))
    return true;

  int found = WiFi.scanNetworks();
  bool tried[MAX_WIFI_PROFILES] = {false};

  if (found > 0)
  {
    for (int attempt = 0; attempt < wifiProfileCount; attempt++)
    {
      int best = -1;
      int bestRssi = -999;

      for (int i = 0; i < wifiProfileCount; i++)
      {
        if (tried[i])
          continue;
        for (int s = 0; s < found; s++)
        {
          if (WiFi.SSID(s) == wifiProfiles[i].ssid && WiFi.RSSI(s) > bestRssi)
          {
            bestRssi = WiFi.RSSI(s);
            best = i;
          }
        }
      }

      if (best < 0)
        break;
      tried[best] = true;
      if (connectProfile(best, 8000))
      {
        WiFi.scanDelete();
        return true;
      }
    }
  }
  WiFi.scanDelete();

  // Hidden networks do not show up in a scan, so try the rest as a fallback.
  for (int i = 0; i < wifiProfileCount; i++)
  {
    if (tried[i])
      continue;
    if (connectProfile(i, 8000))
      return true;
  }
  return false;
}

void drawPortalScreen(const char *subtitle)
{
  tft.fillScreen(T.bg);
  tft.drawRoundRect(20, 20, 440, 280, 12, T.cardBorder);

  tft.setTextDatum(MC_DATUM);
  tft.setTextFont(4);
  tft.setTextColor(T.accent1, T.bg);
  tft.drawString("WIFI SETUP PORTAL", 240, 50);

  tft.setTextFont(2);
  tft.setTextColor(T.textWhite, T.bg);
  tft.drawString(subtitle, 240, 90);
  tft.drawString("Connect to this access point:", 240, 125);

  tft.fillRoundRect(60, 148, 360, 36, 6, T.headerBg);
  tft.drawRoundRect(60, 148, 360, 36, 6, T.gold);
  tft.setTextFont(4);
  tft.setTextColor(T.gold, T.headerBg);
  tft.drawString(WIFI_AP_SSID, 240, 166);

  tft.setTextFont(2);
  tft.setTextColor(T.textMuted, T.bg);
  tft.drawString(String("Password: ") + WIFI_AP_PASS, 240, 205);
  tft.drawString("Open 192.168.4.1 to add / change", 240, 235);
  tft.drawString("a network and its JSON data URL", 240, 255);
  tft.setTextDatum(TL_DATUM);
}

bool startConfigPortal()
{
  networkBusy = true;
  drawPortalScreen("Starting configuration portal...");

  WiFiManager wm;
  String currentUrl = getServerUrl();
  WiFiManagerParameter urlParam("server_url", "LibreHardware JSON URL", currentUrl.c_str(), 128);
  wm.addParameter(&urlParam);
  wm.setConfigPortalTimeout(240);

  bool connected = wm.startConfigPortal(WIFI_AP_SSID, WIFI_AP_PASS);

  if (connected)
  {
    String ssid = wm.getWiFiSSID();
    String pass = wm.getWiFiPass();
    String url = urlParam.getValue();
    url.trim();

    if (!ssid.length() && WiFi.status() == WL_CONNECTED)
      ssid = WiFi.SSID();
    if (!pass.length() && WiFi.status() == WL_CONNECTED && WiFi.SSID() == ssid)
      pass = WiFi.psk();
    if (!url.length())
      url = currentUrl;

    if (ssid.length())
    {
      int idx = upsertWifiProfile(ssid, pass, url);
      if (idx >= 0)
      {
        activeProfile = idx;
        prefs.putInt("net_last", idx);
        setServerUrl(url);
        resetTelemetry();
        configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
      }
    }
  }
  else
  {
    WiFi.mode(WIFI_STA);
    if (activeProfile >= 0 && activeProfile < wifiProfileCount)
      connectProfile(activeProfile, 8000);
  }

  networkBusy = false;
  return connected;
}

void setupWiFi()
{
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  loadWifiProfiles();

  String storedUrl = prefs.getString("server_url", serverUrl);
  setServerUrl(storedUrl);

  // Migrate the single credential set used by older firmware versions.
  if (wifiProfileCount == 0)
  {
    WiFi.begin();
    if (waitForWifi(8000) && WiFi.SSID().length())
    {
      int idx = upsertWifiProfile(WiFi.SSID(), WiFi.psk(), storedUrl);
      activeProfile = idx;
      prefs.putInt("net_last", idx);
    }
  }

  if (WiFi.status() != WL_CONNECTED && !connectToAnySavedNetwork())
  {
    if (!startConfigPortal())
    {
      Serial.println("Portal timeout, restarting...");
      delay(2000);
      ESP.restart();
    }
  }

  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
}

// =========================================================================
//  HTTP BACKGROUND FETCH TASK (CORE 0)
// =========================================================================
// Keep only the fields the scanner needs. LibreHardwareMonitor's full
// data.json is ~120 KB; keeping Min/Max/ImageURL/etc. for every sensor can
// exhaust the ESP32 heap and make deserializeJson() return NoMemory.
void buildLhmFilter(JsonObject level, int depth)
{
  level["HardwareId"] = true;
  level["Text"] = true;
  level["Type"] = true;
  level["SensorId"] = true;
  level["Value"] = true;
  if (depth > 0)
  {
    JsonObject child = level["Children"][0].to<JsonObject>();
    buildLhmFilter(child, depth - 1);
  }
}

void httpFetchTask(void *pvParameters)
{
  JsonDocument filter;
  buildLhmFilter(filter.to<JsonObject>(), 7);

  for (;;)
  {
    if (!networkBusy && currentPage == 0 && monitorSubPage == 0 &&
        WiFi.status() == WL_CONNECTED)
    {
      String url = getServerUrl();
      url.trim();

      HTTPClient http;
      if (!url.length() || !http.begin(url))
      {
        lastHttpCode = -1000;
        lastJsonError = 0;
        lastFetchHeap = ESP.getFreeHeap();
        Serial.printf("HTTP begin failed: '%s' heap=%u\n", url.c_str(), lastFetchHeap);
        http.end();
        vTaskDelay(pdMS_TO_TICKS(1000));
        continue;
      }

      http.setConnectTimeout(4000);
      http.setTimeout(10000);

      int httpCode = http.GET();
      lastHttpCode = httpCode;
      lastFetchHeap = ESP.getFreeHeap();

      if (httpCode == HTTP_CODE_OK)
      {
        JsonDocument doc;
        DeserializationError error = deserializeJson(
            doc, http.getStream(),
            DeserializationOption::Filter(filter),
            DeserializationOption::NestingLimit(12));

        lastJsonError = error ? (int)error.code() : 0;
        lastFetchHeap = ESP.getFreeHeap();
        if (!error)
        {
          ScanResult scan;
          scanSensorNode(doc.as<JsonVariant>(), HW_OTHER, -1, scan);
          finalizeScan(scan);

          static unsigned long lastHistoryPush = 0;
          if (millis() - lastHistoryPush >= 1000)
          {
            lastHistoryPush = millis();
            float cpuMetric = scan.data.cpuHasTemp ? scan.data.cpuTemp : scan.data.cpuLoad;
            float gpuMetric = scan.data.gpuHasTemp ? scan.data.gpuTemp : scan.data.gpuLoad;
            pushHistory(cpuHistory, cpuMetric);
            pushHistory(gpuHistory, gpuMetric);
          }

          lastSensorFound = scan.data.valid;

          if (scan.data.valid)
          {
            commitLiveData(scan.data);
            lastSuccessFetch = millis();
            dataUpdated = true;

            static unsigned long lastOkLog = 0;
            if (millis() - lastOkLog >= 5000)
            {
              lastOkLog = millis();
              Serial.printf("DATA ok: cpu=%.1fC/%.1f%%/%.1fW gpu=%.1fC/%.1f%%/%.0fMB ram=%.1f/%.1fGB load=%.1f%% heap=%u\n",
                            scan.data.cpuTemp, scan.data.cpuLoad, scan.data.cpuPower,
                            scan.data.gpuTemp, scan.data.gpuLoad, scan.data.gpuMemUsed,
                            scan.data.ramUsed, scan.data.ramTotal, scan.data.ramLoad,
                            ESP.getFreeHeap());
            }
          }
          else
          {
            static unsigned long lastEmptyLog = 0;
            if (millis() - lastEmptyLog >= 5000)
            {
              lastEmptyLog = millis();
              Serial.printf("JSON ok but no sensors found: heap=%u\n", ESP.getFreeHeap());
            }
          }
        }
        else
        {
          Serial.printf("JSON error: %s (code %d) heap=%u\n",
                        error.c_str(), (int)error.code(), ESP.getFreeHeap());
        }
      }
      else
      {
        lastJsonError = 0;
        Serial.printf("HTTP error: %d url=%s heap=%u\n",
                      httpCode, url.c_str(), ESP.getFreeHeap());
      }

      http.end();
      vTaskDelay(pdMS_TO_TICKS(400));
    }
    else
    {
      vTaskDelay(pdMS_TO_TICKS(300));
    }
  }
}

// =========================================================================
//  NAVIGATION & UI RENDERING
// =========================================================================
void drawHeaderTabs()
{
  tft.fillRect(0, 0, 480, 32, T.headerBg);
  tft.drawFastHLine(0, 32, 480, T.cardBorder);

  const char *tabNames[4] = {"MONITOR", "CLOCK", "ANIMATION", "SETTINGS"};
  uint16_t tabAccents[4] = {T.accent1, T.accent2, T.tempCool, T.gold};

  const int tabX0 = 2;
  const int tabY = 4;
  const int tabW = 92;
  const int tabH = 26;
  const int tabGap = 2;

  for (int i = 0; i < TOTAL_PAGES; i++)
  {
    int tx = tabX0 + i * (tabW + tabGap);

    if (i == currentPage)
    {
      tft.fillRect(tx, tabY, tabW, 28, T.cardBg);
      tft.drawRect(tx, tabY, tabW, 28, T.cardBorder);
      tft.fillRect(tx + 1, tabY, tabW - 2, 3, tabAccents[i]);
      tft.drawFastHLine(tx + 1, 32, tabW - 2, T.cardBg);

      tft.setTextFont(2);
      tft.setTextColor(T.textWhite, T.cardBg);
      drawCenteredText(tabNames[i], tx + tabW / 2, tabY + 14, 2);
    }
    else
    {
      tft.fillRect(tx, tabY, tabW, tabH, T.headerBg);
      tft.drawRect(tx, tabY, tabW, tabH, T.cardBorder);

      tft.setTextFont(2);
      tft.setTextColor(T.textMuted, T.headerBg);
      drawCenteredText(tabNames[i], tx + tabW / 2, tabY + tabH / 2, 2);
    }
  }
  updateHeaderWifi();
}

void updateHeaderWifi()
{
  int x = 383, y = 9;
  long rssi = WiFi.RSSI();
  bool connected = (WiFi.status() == WL_CONNECTED);

  int bars = 0;
  if (connected)
  {
    if (rssi > -55)
      bars = 4;
    else if (rssi > -67)
      bars = 3;
    else if (rssi > -78)
      bars = 2;
    else if (rssi > -88)
      bars = 1;
  }

  tft.fillRect(x - 2, 0, 92, 32, T.headerBg);

  for (int i = 0; i < 4; i++)
  {
    int barW = 3, barH = 3 + i * 2, barX = x + i * 5, barY = y + (9 - barH);
    tft.fillRect(barX, barY, barW, barH, (i < bars) ? T.tempCool : T.textDark);
  }

  tft.setTextFont(1);
  tft.setTextColor(T.textMuted, T.headerBg);
  tft.setCursor(x + 24, y + 1);
  if (connected)
    tft.printf("%ddB", (int)rssi);
  else
    tft.print("N/A");
}

void drawSparklineGraph(int x, int y, int w, int h, float *history, uint16_t lineColor,
                        const char *unit, float minClamp, float maxClamp)
{
  if (!graphSprite.created())
    return;

  graphSprite.fillSprite(T.cardBg);
  graphSprite.drawRect(0, 0, w, h, T.cardBorder);
  graphSprite.drawFastHLine(1, h / 2, w - 2, T.cardBorder);

  if (historyCount < 2)
  {
    graphSprite.setTextDatum(TL_DATUM);
    graphSprite.setTextFont(1);
    graphSprite.setTextColor(T.textMuted, T.cardBg);
    graphSprite.drawString("Collecting samples...", 30, h / 2 - 4);
    graphSprite.pushSprite(x, y);
    return;
  }

  float minVal = 9999.0f, maxVal = -9999.0f;
  for (int i = 0; i < HISTORY_LEN; i++)
  {
    if (history[i] > 0.0f)
    {
      if (history[i] < minVal)
        minVal = history[i];
      if (history[i] > maxVal)
        maxVal = history[i];
    }
  }

  if (maxVal < 0.0f)
  {
    graphSprite.setTextDatum(TL_DATUM);
    graphSprite.setTextFont(1);
    graphSprite.setTextColor(T.textMuted, T.cardBg);
    graphSprite.drawString("Collecting samples...", 30, h / 2 - 4);
    graphSprite.pushSprite(x, y);
    return;
  }

  if (maxVal - minVal < 8.0f)
  {
    maxVal += 4.0f;
    minVal -= 4.0f;
  }
  minVal = max(minVal, minClamp);
  maxVal = min(maxVal, maxClamp);
  if (maxVal - minVal < 1.0f)
    maxVal = minVal + 1.0f;

  int prevPx = -1, prevPy = -1;
  float stepX = (float)(w - 4) / (float)(HISTORY_LEN - 1);

  for (int i = 0; i < HISTORY_LEN; i++)
  {
    if (history[i] <= 0.0f)
      continue;
    int px = 2 + (int)(i * stepX);
    float norm = constrain((history[i] - minVal) / (maxVal - minVal), 0.0f, 1.0f);
    int py = (h - 3) - (int)(norm * (h - 6));

    if (prevPx != -1)
    {
      graphSprite.drawLine(prevPx, prevPy, px, py, lineColor);
      graphSprite.drawLine(prevPx, prevPy - 1, px, py - 1, lineColor);
    }
    prevPx = px;
    prevPy = py;
  }

  graphSprite.setTextDatum(TL_DATUM);
  graphSprite.setTextFont(1);
  graphSprite.setTextColor(T.textMuted, T.cardBg);
  graphSprite.drawString(String((int)(maxVal + 0.5f)) + unit, 4, 3);
  graphSprite.drawString(String((int)(minVal + 0.5f)) + unit, 4, h - 10);
  graphSprite.pushSprite(x, y);
}

void drawMonitorPage()
{
  tft.setTextDatum(TL_DATUM);
  tft.fillRect(0, 32, 480, 288, T.bg);
  LiveData data = snapshotLiveData();

  if (monitorSubPage == 0)
  {
    // ---- CPU / GPU cards -------------------------------------------------
    tft.fillRoundRect(8, 36, 228, 210, 8, T.cardBg);
    tft.drawRoundRect(8, 36, 228, 210, 8, T.cardBorder);
    tft.fillRoundRect(16, 43, 38, 18, 4, T.accent1);
    tft.setTextFont(2);
    tft.setTextColor(T.bg, T.accent1);
    drawCenteredText("CPU", 35, 52, 2);

    tft.fillRoundRect(244, 36, 228, 210, 8, T.cardBg);
    tft.drawRoundRect(244, 36, 228, 210, 8, T.cardBorder);
    tft.fillRoundRect(252, 43, 38, 18, 4, T.accent2);
    tft.setTextFont(2);
    tft.setTextColor(T.bg, T.accent2);
    drawCenteredText("GPU", 271, 52, 2);

    tft.fillRect(60, 48, 162, 9, T.cardBg);
    drawNameText(60, 48, 162, data.cpuName);

    int gpuNameMax = (data.gpuHasHotspot ? 368 : 464) - 296 - 6;
    tft.fillRect(296, 48, 168, 9, T.cardBg);
    drawNameText(296, 48, gpuNameMax, data.gpuName);
    if (data.gpuHasHotspot)
      drawGpuHotspot(data);

    tft.setTextFont(1);
    tft.setTextColor(T.textMuted, T.cardBg);
    tft.drawString("LOAD", 16, 117);
    tft.drawString("LOAD", 252, 117);

    // ---- RAM card --------------------------------------------------------
    tft.fillRoundRect(8, 251, 464, 64, 8, T.cardBg);
    tft.drawRoundRect(8, 251, 464, 64, 8, T.cardBorder);
    tft.fillRoundRect(16, 257, 44, 18, 4, T.accent3);
    tft.setTextFont(2);
    tft.setTextColor(T.bg, T.accent3);
    drawCenteredText("RAM", 38, 266, 2);
    tft.setTextFont(1);
    tft.setTextColor(T.textMuted, T.cardBg);
    tft.drawString("SYSTEM MEMORY", 68, 260);

    // ---- footer ----------------------------------------------------------
    tft.fillRoundRect(320, 292, 144, 20, 4, T.accent2);
    tft.setTextFont(2);
    tft.setTextColor(T.bg, T.accent2);
    drawCenteredText("WIFI DIAG >", 392, 302, 2);
  }
  else
  {
    // ---- Wi-Fi diagnostics ----------------------------------------------
    tft.fillRoundRect(8, 36, 464, 279, 8, T.cardBg);
    tft.drawRoundRect(8, 36, 464, 279, 8, T.cardBorder);

    tft.fillRoundRect(16, 44, 150, 22, 4, T.accent1);
    tft.setTextFont(2);
    tft.setTextColor(T.bg, T.accent1);
    tft.drawString("WIFI DIAGNOSTICS", 22, 46);
    tft.drawFastHLine(16, 74, 448, T.cardBorder);

    tft.fillRect(16, 82, 220, 100, T.headerBg);
    tft.drawRoundRect(16, 82, 220, 100, 6, T.cardBorder);
    tft.setTextFont(2);
    tft.setTextColor(T.gold, T.headerBg);
    tft.drawString("LINK QUALITY", 26, 89);

    tft.fillRect(244, 82, 220, 100, T.headerBg);
    tft.drawRoundRect(244, 82, 220, 100, 6, T.cardBorder);
    tft.setTextFont(2);
    tft.setTextColor(T.gold, T.headerBg);
    tft.drawString("LATENCY (PING)", 254, 89);

    tft.fillRect(16, 190, 448, 92, T.headerBg);
    tft.drawRoundRect(16, 190, 448, 92, 6, T.cardBorder);
    tft.setTextFont(2);
    tft.setTextColor(T.accent3, T.headerBg);
    tft.drawString("NETWORK CONFIGURATION", 26, 197);

    tft.setTextFont(1);
    tft.setTextColor(T.textMuted, T.headerBg);
    tft.setCursor(26, 222);
    tft.printf("LOCAL IP   : %s", WiFi.localIP().toString().c_str());
    tft.setCursor(26, 240);
    tft.printf("GATEWAY IP : %s", WiFi.gatewayIP().toString().c_str());
    tft.setCursor(26, 258);
    tft.printf("SUBNET MASK: %s", WiFi.subnetMask().toString().c_str());

    tft.setCursor(244, 222);
    tft.printf("MAC ADDRESS: %s", WiFi.macAddress().c_str());
    tft.setCursor(244, 240);
    tft.printf("DNS SERVER : %s", WiFi.dnsIP().toString().c_str());
    tft.setCursor(244, 258);
    String ssid = WiFi.SSID();
    if (ssid.length() > 18)
      ssid = ssid.substring(0, 18);
    tft.printf("SSID       : %s", ssid.c_str());

    drawFeedStatus(16, 296);

    tft.fillRoundRect(320, 292, 144, 20, 4, T.accent1);
    tft.setTextFont(2);
    tft.setTextColor(T.bg, T.accent1);
    drawCenteredText("< HARDWARE", 392, 302, 2);
  }
}

void updateMonitorData()
{
  tft.setTextDatum(TL_DATUM);
  LiveData data = snapshotLiveData();

  if (monitorSubPage == 0)
  {
    static char lastCpuName[44] = "";
    static char lastGpuName[44] = "";
    static bool lastHotspot = false;

    bool hotspot = data.gpuHasHotspot;
    bool namesChanged = strcmp(lastCpuName, data.cpuName) != 0 ||
                        strcmp(lastGpuName, data.gpuName) != 0 ||
                        hotspot != lastHotspot;

    if (namesChanged)
    {
      tft.fillRect(60, 48, 162, 9, T.cardBg);
      drawNameText(60, 48, 162, data.cpuName);

      tft.fillRect(296, 48, 168, 9, T.cardBg);
      int gpuNameMax = (hotspot ? 368 : 464) - 296 - 6;
      drawNameText(296, 48, gpuNameMax, data.gpuName);

      if (!hotspot)
        tft.fillRect(368, 43, 96, 18, T.cardBg);

      strlcpy(lastCpuName, data.cpuName, sizeof(lastCpuName));
      strlcpy(lastGpuName, data.gpuName, sizeof(lastGpuName));
      lastHotspot = hotspot;
    }

    if (hotspot)
      drawGpuHotspot(data);

    // ---- CPU -------------------------------------------------------------
    bool cpuTempOk = data.valid && data.cpuHasTemp && data.cpuTemp > 0.0f;
    float cpuMetric = cpuTempOk ? data.cpuTemp : data.cpuLoad;
    uint16_t cpuColor = !data.valid ? T.textMuted
                                    : (cpuTempOk ? getTempColor(data.cpuTemp)
                                                 : getUsageColor(data.cpuLoad));

    char cpuBuff[16];
    if (!data.valid)
      snprintf(cpuBuff, sizeof(cpuBuff), "--.-");
    else if (cpuMetric >= 100.0f)
      snprintf(cpuBuff, sizeof(cpuBuff), "%.0f", cpuMetric);
    else
      snprintf(cpuBuff, sizeof(cpuBuff), "%.1f", cpuMetric);

    int cpuNumWidth = tft.textWidth(cpuBuff, 6);
    tft.fillRect(16, 65, 130, 46, T.cardBg);
    tft.setTextFont(6);
    tft.setTextColor(cpuColor, T.cardBg);
    tft.drawString(cpuBuff, 16, 65);
    if (data.valid)
      drawUnit(16 + cpuNumWidth + 3, 71, cpuTempOk, T.textMuted, T.cardBg);

    drawTrendBadge(148, 75, getTrendDelta(cpuHistory), T.cardBg);

    tft.fillRect(106, 117, 38, 9, T.cardBg);
    tft.fillRect(146, 117, 82, 9, T.cardBg);
    drawMiniBar(46, 119, 54, 6, data.cpuLoad, 100.0f, getUsageColor(data.cpuLoad));
    tft.setTextFont(1);
    tft.setTextColor(T.textMuted, T.cardBg);
    if (data.valid)
      snprintf(cpuBuff, sizeof(cpuBuff), "%.1f%%", data.cpuLoad);
    else
      snprintf(cpuBuff, sizeof(cpuBuff), "--.-%%");
    tft.drawString(cpuBuff, 106, 117);

    char cpuExtra[20];
    if (!data.valid)
      snprintf(cpuExtra, sizeof(cpuExtra), "--");
    else if (data.cpuFan > 0)
      snprintf(cpuExtra, sizeof(cpuExtra), "%d RPM", data.cpuFan);
    else if (data.cpuPower > 0.0f)
      snprintf(cpuExtra, sizeof(cpuExtra), "%.0f W", data.cpuPower);
    else if (!cpuTempOk)
      snprintf(cpuExtra, sizeof(cpuExtra), "TEMP N/A");
    else
      snprintf(cpuExtra, sizeof(cpuExtra), "-- W");
    drawRightText(cpuExtra, 228, 117, 1, T.textMuted, T.cardBg);

    drawSparklineGraph(16, 133, 212, 104, cpuHistory, T.accent1,
                       cpuTempOk ? "C" : "%", cpuTempOk ? 20.0f : 0.0f,
                       cpuTempOk ? 110.0f : 100.0f);

    // ---- GPU -------------------------------------------------------------
    bool gpuTempOk = data.valid && data.gpuHasTemp && data.gpuTemp > 0.0f;
    float gpuMetric = gpuTempOk ? data.gpuTemp : data.gpuLoad;
    uint16_t gpuColor = !data.valid ? T.textMuted
                                    : (gpuTempOk ? getTempColor(data.gpuTemp)
                                                 : getUsageColor(data.gpuLoad));

    char gpuBuff[16];
    if (!data.valid)
      snprintf(gpuBuff, sizeof(gpuBuff), "--.-");
    else if (gpuMetric >= 100.0f)
      snprintf(gpuBuff, sizeof(gpuBuff), "%.0f", gpuMetric);
    else
      snprintf(gpuBuff, sizeof(gpuBuff), "%.1f", gpuMetric);

    int gpuNumWidth = tft.textWidth(gpuBuff, 6);
    tft.fillRect(252, 65, 130, 46, T.cardBg);
    tft.setTextFont(6);
    tft.setTextColor(gpuColor, T.cardBg);
    tft.drawString(gpuBuff, 252, 65);
    if (data.valid)
      drawUnit(252 + gpuNumWidth + 3, 71, gpuTempOk, T.textMuted, T.cardBg);

    drawTrendBadge(388, 75, getTrendDelta(gpuHistory), T.cardBg);

    tft.fillRect(342, 117, 38, 9, T.cardBg);
    tft.fillRect(380, 117, 84, 9, T.cardBg);
    drawMiniBar(282, 119, 54, 6, data.gpuLoad, 100.0f, getUsageColor(data.gpuLoad));
    tft.setTextFont(1);
    tft.setTextColor(T.textMuted, T.cardBg);
    if (data.valid)
      snprintf(gpuBuff, sizeof(gpuBuff), "%.1f%%", data.gpuLoad);
    else
      snprintf(gpuBuff, sizeof(gpuBuff), "--.-%%");
    tft.drawString(gpuBuff, 342, 117);

    char gpuExtra[20];
    if (data.valid && data.gpuHasMem)
    {
      if (data.gpuMemUsed >= 1024.0f)
        snprintf(gpuExtra, sizeof(gpuExtra), "VRAM: %.1fGB", data.gpuMemUsed / 1024.0f);
      else
        snprintf(gpuExtra, sizeof(gpuExtra), "VRAM: %.0fMB", data.gpuMemUsed);
    }
    else
    {
      snprintf(gpuExtra, sizeof(gpuExtra), "VRAM: --");
    }
    drawRightText(gpuExtra, 464, 117, 1, T.textMuted, T.cardBg);

    drawSparklineGraph(252, 133, 212, 104, gpuHistory, T.accent2,
                       gpuTempOk ? "C" : "%", gpuTempOk ? 20.0f : 0.0f,
                       gpuTempOk ? 110.0f : 100.0f);

    // ---- RAM -------------------------------------------------------------
    bool ramValid = data.ramValid && data.ramUsed > 0.0f;
    uint16_t ramColor = getUsageColor(data.ramLoad);

    tft.fillRect(318, 255, 148, 20, T.cardBg);
    char ramUsedText[32];
    if (ramValid)
      snprintf(ramUsedText, sizeof(ramUsedText), "%.1f / %.1f GB", data.ramUsed, data.ramTotal);
    else
      snprintf(ramUsedText, sizeof(ramUsedText), "N/A");
    drawRightText(ramUsedText, 414, 260, 1, T.accent1, T.cardBg);

    char ramPctText[16];
    if (ramValid)
      snprintf(ramPctText, sizeof(ramPctText), "%.1f%%", data.ramLoad);
    else
      snprintf(ramPctText, sizeof(ramPctText), "--.-%%");
    drawRightText(ramPctText, 464, 257, 2, ramColor, T.cardBg);

    drawMiniBar(16, 279, 448, 8, data.ramLoad, 100.0f, ramColor);

    // ---- endpoint / stale-data indicator --------------------------------
    bool stale = lastSuccessFetch == 0 || (millis() - lastSuccessFetch > 10000UL);
    String endpoint = fitText(String("SOURCE: ") + getServerUrl(), 296, 1);
    tft.fillRect(16, 299, 296, 10, T.cardBg);
    tft.setTextFont(1);
    tft.setTextColor(stale ? T.tempHot : T.textMuted, T.cardBg);
    tft.drawString(endpoint, 16, 300);
  }
  else
  {
    // ---- Wi-Fi diagnostics live values ----------------------------------
    bool wifiUp = (WiFi.status() == WL_CONNECTED);
    long rssi = wifiUp ? WiFi.RSSI() : 0;
    int signalPct = wifiUp ? constrain(2 * (rssi + 100), 0, 100) : 0;

    long pingGw = measureLatency(WiFi.gatewayIP().toString().c_str(), 80);
    long pingTarget = measureLatency(PING_TARGETS[currentPingTargetIdx].host,
                                     PING_TARGETS[currentPingTargetIdx].port);

    tft.fillRect(26, 108, 112, 50, T.headerBg);
    tft.setTextFont(6);
    tft.setTextColor(T.accent1, T.headerBg);
    tft.setCursor(26, 112);
    tft.printf("%d%%", signalPct);

    tft.fillRect(146, 108, 76, 52, T.headerBg);
    tft.setTextFont(1);
    tft.setTextColor(T.textMuted, T.headerBg);
    String ssid = wifiUp ? WiFi.SSID() : String("-");
    if (ssid.length() > 8)
      ssid = ssid.substring(0, 8);
    tft.setCursor(148, 112);
    if (wifiUp)
      tft.printf("RSSI %d", (int)rssi);
    else
      tft.print("RSSI --");
    tft.setCursor(148, 130);
    if (wifiUp)
      tft.printf("CH   %d", WiFi.channel());
    else
      tft.print("CH   --");
    tft.setCursor(148, 148);
    tft.printf("SSID %.8s", ssid.c_str());

    tft.fillRect(254, 108, 204, 14, T.headerBg);
    tft.setTextFont(1);
    tft.setTextColor(T.gold, T.headerBg);
    String target = fitText(String("TARGET: ") + PING_TARGETS[currentPingTargetIdx].name, 200, 1);
    tft.drawString(target, 254, 110);

    tft.fillRect(254, 126, 204, 40, T.headerBg);
    tft.setTextFont(2);
    tft.setTextColor(T.textWhite, T.headerBg);
    tft.setCursor(254, 130);
    if (pingGw >= 0)
      tft.printf("GATEWAY : %ld ms", pingGw);
    else
      tft.print("GATEWAY : TIMEOUT");

    tft.setCursor(254, 150);
    if (pingTarget >= 0)
      tft.printf("SERVER  : %ld ms", pingTarget);
    else
      tft.print("SERVER  : TIMEOUT");

    drawFeedStatus(16, 296);
  }
}

void drawClockPage()
{
  forceSubPageRefresh = true;
  tft.fillRoundRect(8, 36, 464, 279, 8, T.cardBg);
  tft.drawRoundRect(8, 36, 464, 279, 8, T.cardBorder);
  tft.setTextDatum(MC_DATUM);

  if (clockSubPage == 0)
  {
    tft.fillRoundRect(16, 44, 110, 24, 4, T.accent1);
    tft.setTextFont(2);
    tft.setTextColor(T.bg, T.accent1);
    tft.drawString("STANDBY CLOCK", 71, 56);
    tft.fillRoundRect(134, 44, 94, 24, 4, T.headerBg);
    tft.drawRoundRect(134, 44, 94, 24, 4, T.cardBorder);
    tft.setTextFont(1);
    tft.setTextColor(T.gold, T.headerBg);
    tft.drawString("NTP: GMT+7", 181, 56);
    tft.fillRoundRect(320, 44, 144, 24, 4, T.accent2);
    tft.setTextFont(2);
    tft.setTextColor(T.bg, T.accent2);
    tft.drawString("POMODORO HUB >", 392, 56);
    tft.drawFastHLine(20, 78, 440, T.cardBorder);
    tft.setTextDatum(TL_DATUM);
    tft.setTextFont(1);
    tft.setTextColor(T.textMuted, T.cardBg);
    tft.drawString("REALTIME SECONDS PROGRESS METER", 20, 252);
  }
  else
  {
    tft.fillRoundRect(16, 44, 120, 24, 4, T.accent2);
    tft.setTextFont(2);
    tft.setTextColor(T.bg, T.accent2);
    tft.drawString("POMODORO HUB", 76, 56);
    tft.fillRoundRect(336, 44, 128, 24, 4, T.accent1);
    tft.setTextFont(2);
    tft.setTextColor(T.bg, T.accent1);
    tft.drawString("< CLOCK MODE", 400, 56);
    tft.drawFastHLine(20, 78, 440, T.cardBorder);
    tft.fillRoundRect(90, 88, 300, 60, 8, T.headerBg);
    tft.drawRoundRect(90, 88, 300, 60, 8, T.cardBorder);

    tft.fillRoundRect(30, 95, 46, 46, 6, T.headerBg);
    tft.drawRoundRect(30, 95, 46, 46, 6, T.cardBorder);
    tft.setTextFont(4);
    tft.setTextColor(T.textWhite, T.headerBg);
    tft.drawString("-", 53, 118);

    tft.fillRoundRect(404, 95, 46, 46, 6, T.headerBg);
    tft.drawRoundRect(404, 95, 46, 46, 6, T.cardBorder);
    tft.setTextFont(4);
    tft.setTextColor(T.textWhite, T.headerBg);
    tft.drawString("+", 427, 118);

    const char *presetLabels[4] = {"10m", "15m", "25m", "45m"};
    for (int i = 0; i < 4; i++)
    {
      int bx = 30 + i * 110;
      tft.fillRoundRect(bx, 182, 90, 32, 6, T.headerBg);
      tft.drawRoundRect(bx, 182, 90, 32, 6, T.cardBorder);
      tft.setTextFont(2);
      tft.setTextColor(T.textWhite, T.headerBg);
      tft.drawString(presetLabels[i], bx + 45, 198);
    }

    uint16_t startBg = pomodoroActive ? T.tempWarm : T.tempCool;
    tft.fillRoundRect(80, 240, 150, 42, 6, startBg);
    tft.setTextFont(4);
    tft.setTextColor(T.bg, startBg);
    tft.drawString(pomodoroActive ? "PAUSE" : "START", 155, 261);

    tft.fillRoundRect(250, 240, 150, 42, 6, T.headerBg);
    tft.drawRoundRect(250, 240, 150, 42, 6, T.cardBorder);
    tft.setTextFont(4);
    tft.setTextColor(T.tempHot, T.headerBg);
    tft.drawString("RESET", 325, 261);

    tft.setTextDatum(TL_DATUM);
    tft.setTextFont(1);
    tft.setTextColor(T.textMuted, T.cardBg);
    tft.drawString("COMPLETED SESSIONS:", 30, 294);
  }
  updateClockPage(true);
}

void updateClockPage(bool secondChanged)
{
  time_t now;
  time(&now);
  struct tm timeinfo;
  localtime_r(&now, &timeinfo);
  if (timeinfo.tm_year < 120 && !getLocalTime(&timeinfo, 0))
    return;

  if (pomodoroActive)
  {
    if (millis() >= pomodoroEndMillis)
    {
      pomodoroActive = false;
      pomodoroFinished = true;
      pomodoroBlinkStart = millis();
      pomodoroRemainingMs = 0;
      pomodoroSessionsCompleted++;
    }
    else
    {
      pomodoroRemainingMs = pomodoroEndMillis - millis();
    }
  }

  tft.setTextDatum(MC_DATUM);

  if (clockSubPage == 0)
  {
    if (secondChanged || forceSubPageRefresh)
    {
      char timeStr[12];
      snprintf(timeStr, sizeof(timeStr), "%02d:%02d:%02d", timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
      tft.setTextFont(7);
      tft.setTextColor(T.accent1, T.cardBg);
      tft.drawString(timeStr, 240, 130);

      static int lastMday = -1;
      if (timeinfo.tm_mday != lastMday || forceSubPageRefresh)
      {
        lastMday = timeinfo.tm_mday;
        const char *days[] = {"SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"};
        const char *months[] = {"JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"};
        char dateStr[40];
        snprintf(dateStr, sizeof(dateStr), "%s, %02d %s %04d", days[timeinfo.tm_wday], timeinfo.tm_mday, months[timeinfo.tm_mon], timeinfo.tm_year + 1900);
        tft.setTextFont(4);
        tft.setTextColor(T.gold, T.cardBg);
        tft.drawString(dateStr, 240, 201);
      }

      int barStartX = 20, barY = 270;
      for (int s = 0; s < 60; s++)
      {
        int sx = barStartX + s * 7 + (s / 10) * 4;
        tft.fillRect(sx, barY, 5, 14, (s <= timeinfo.tm_sec) ? T.accent1 : T.barTrack);
      }
    }
  }
  else
  {
    static int lastPomoSecRemaining = -1, lastPomoMinVal = -1, lastPomoSessions = -1;
    static bool lastPomoActive = false, lastPomoFinished = false;

    int currentSecRemaining = (pomodoroActive || pomodoroPaused) ? (int)((pomodoroRemainingMs + 999) / 1000) : (pomodoroMinutes * 60);

    bool stateChanged = (pomodoroActive != lastPomoActive) || (pomodoroFinished != lastPomoFinished) ||
                        (pomodoroMinutes != lastPomoMinVal) || (currentSecRemaining != lastPomoSecRemaining) || forceSubPageRefresh;

    if (stateChanged)
    {
      lastPomoActive = pomodoroActive;
      lastPomoFinished = pomodoroFinished;
      lastPomoMinVal = pomodoroMinutes;
      lastPomoSecRemaining = currentSecRemaining;

      uint16_t badgeBg = pomodoroFinished ? T.tempHot : (pomodoroActive ? T.accent1 : T.cardBorder);
      tft.fillRoundRect(144, 44, 184, 24, 4, badgeBg);
      tft.setTextFont(2);
      tft.setTextColor(pomodoroFinished ? T.textWhite : (pomodoroActive ? T.bg : T.textMuted), badgeBg);
      tft.drawString(pomodoroFinished ? "BREAK TIME!" : (pomodoroActive ? "FOCUSING" : "READY"), 236, 56);

      char pomoStr[16];
      if (pomodoroActive || pomodoroPaused)
        snprintf(pomoStr, sizeof(pomoStr), "%02d:%02d", currentSecRemaining / 60, currentSecRemaining % 60);
      else
        snprintf(pomoStr, sizeof(pomoStr), "%02d:00", pomodoroMinutes);

      uint16_t pomoColor = pomodoroFinished ? T.tempHot : (pomodoroActive ? T.accent1 : T.textWhite);
      tft.setTextFont(7);
      tft.setTextColor(pomoColor, T.headerBg);
      tft.drawString(pomoStr, 240, 118);

      float pct = (pomodoroDurationMs > 0 && (pomodoroActive || pomodoroPaused)) ? (float)pomodoroRemainingMs / (float)pomodoroDurationMs : 1.0;
      drawMiniBar(90, 156, 300, 8, pct * 100.0, 100.0, pomoColor);

      uint16_t startBg = pomodoroActive ? T.tempWarm : T.tempCool;
      tft.fillRoundRect(80, 240, 150, 42, 6, startBg);
      tft.setTextFont(4);
      tft.setTextColor(T.bg, startBg);
      tft.drawString(pomodoroActive ? "PAUSE" : "START", 155, 261);

      if (pomodoroSessionsCompleted != lastPomoSessions || forceSubPageRefresh)
      {
        lastPomoSessions = pomodoroSessionsCompleted;
        tft.fillRect(160, 292, 120, 14, T.cardBg);
        for (int d = 0; d < 5; d++)
        {
          int dotX = 168 + d * 20;
          if (d < pomodoroSessionsCompleted % 6)
            tft.fillCircle(dotX, 298, 5, T.gold);
          else
            tft.drawCircle(dotX, 298, 5, T.cardBorder);
        }
      }
    }
  }
  forceSubPageRefresh = false;
  tft.setTextDatum(TL_DATUM);
}

void buildDvdSprite()
{
  if (!dvdSpriteReady)
    return;
  dvdSprite.fillSprite(0x0000);
  dvdSprite.fillRoundRect(0, 0, DVD_W, DVD_H, 6, dvdColor);
  dvdSprite.setTextDatum(MC_DATUM);
  dvdSprite.setTextFont(2);
  dvdSprite.setTextColor(0x0000, dvdColor);
  dvdSprite.drawString("CYD 3.5", DVD_W / 2, DVD_H / 2);
  dvdSprite.setTextDatum(TL_DATUM);
}

void initAnimation()
{
  tft.fillRoundRect(8, 36, 464, 279, 8, 0x0000);
  tft.drawRoundRect(8, 36, 464, 279, 8, T.cardBorder);
  tft.fillRect(16, 282, 448, 24, 0x0821);
  tft.drawRect(16, 282, 448, 24, T.accent3);

  if (currentAnim == 0)
  {
    for (int i = 0; i < MATRIX_COLS; i++)
    {
      matrixY[i] = (float)random(MATRIX_TOP, 180);
      matrixSpeed[i] = random(4, 9);
    }
  }
  else if (currentAnim == 1)
  {
    for (int i = 0; i < NUM_STARS; i++)
    {
      stars[i].x = random(-200, 200);
      stars[i].y = random(-150, 150);
      stars[i].z = random(10, 300);
    }
  }
  else if (currentAnim == 2)
  {
    dvdX = 100;
    dvdY = 100;
    dvdVX = 1;
    dvdVY = 1;
    dvdAccumX = 0.0f;
    dvdAccumY = 0.0f;
    dvdColor = T.accent1;
    buildDvdSprite();
  }
  animFrameCount = 0;
  lastFpsTime = millis();
  lastAnimUpdate = millis();
}

uint16_t scaleColor565(uint16_t color, uint8_t scale)
{
  uint16_t r = (color >> 11) & 0x1F;
  uint16_t g = (color >> 5) & 0x3F;
  uint16_t b = color & 0x1F;
  r = (r * scale) / 255;
  g = (g * scale) / 255;
  b = (b * scale) / 255;
  return (r << 11) | (g << 5) | b;
}

void renderMatrixFrame(float dt)
{
  const char glyphs[] = "0123456789ABCDEFXYZ#*+<>$%&";
  const int numGlyphs = sizeof(glyphs) - 1;

  // White head fading through progressively darker theme-accent shades.
  uint16_t trailColors[MATRIX_TRAIL];
  trailColors[0] = TFT_WHITE;
  const int shadeStep = 180 / max(1, MATRIX_TRAIL - 2);
  for (int j = 1; j < MATRIX_TRAIL; j++)
  {
    trailColors[j] = scaleColor565(T.accent3, 255 - (j - 1) * shadeStep);
    if (trailColors[j] == 0x0000)
      trailColors[j] = 0x0020;
  }

  // Direct TFT rendering keeps the animation responsive; the column sprite
  // approach was slower on this display because of per-column push overhead.
  tft.setTextDatum(TL_DATUM);
  tft.setTextFont(1);
  tft.setTextSize(1);
  tft.startWrite();
  for (int i = 0; i < MATRIX_COLS; i++)
  {
    int colX = 20 + (i * 420) / (MATRIX_COLS - 1);
    float stepF = (float)matrixSpeed[i] * dt * 60.0f;

    if (matrixY[i] - (MATRIX_TRAIL * MATRIX_CELL) > MATRIX_BOTTOM)
    {
      tft.fillRect(colX, MATRIX_TOP, 10, MATRIX_BOTTOM - MATRIX_TOP, 0x0000);
      matrixY[i] = (float)(MATRIX_TOP + random(0, 30));
      matrixSpeed[i] = random(4, 9);
      stepF = (float)matrixSpeed[i] * dt * 60.0f;
    }

    int headY = (int)matrixY[i];

    // Clear the strip above the tail that the column vacated as it moved down.
    // A full cell of clear removes the previous tail glyph; larger frame steps
    // extend the clear so slow frames cannot leave stale glyphs behind.
    int clearH = max(MATRIX_CELL, (int)ceilf(stepF));
    int clearY = headY - (MATRIX_TRAIL - 1) * MATRIX_CELL - clearH;

    if (clearY < MATRIX_TOP)
    {
      clearH -= (MATRIX_TOP - clearY);
      clearY = MATRIX_TOP;
    }
    if (clearY + clearH > MATRIX_BOTTOM)
      clearH = MATRIX_BOTTOM - clearY;
    if (clearH > 0)
      tft.fillRect(colX, clearY, 10, clearH, 0x0000);

    for (int j = 0; j < MATRIX_TRAIL; j++)
    {
      int y = headY - j * MATRIX_CELL;
      if (y < MATRIX_TOP || y + 8 > MATRIX_BOTTOM)
        continue;
      tft.drawChar(colX + 1, y, glyphs[random(0, numGlyphs)],
                   trailColors[j], 0x0000, 1);
    }

    matrixY[i] += stepF;
  }
  tft.endWrite();
}

void renderStarfieldFrame(float dt)
{
  tft.startWrite();
  for (int i = 0; i < NUM_STARS; i++)
  {
    int oldPx = 240 + (int)(stars[i].x / stars[i].z * 160.0f);
    int oldPy = 160 + (int)(stars[i].y / stars[i].z * 160.0f);
    if (oldPx >= 12 && oldPx <= 467 && oldPy >= 42 && oldPy <= 275)
      tft.drawFastHLine(oldPx, oldPy, 2, 0x0000);

    stars[i].z -= 240.0f * dt;
    if (stars[i].z <= 2.0f)
    {
      stars[i].x = random(-200, 200);
      stars[i].y = random(-150, 150);
      stars[i].z = 300;
    }

    int newPx = 240 + (int)(stars[i].x / stars[i].z * 160.0f);
    int newPy = 160 + (int)(stars[i].y / stars[i].z * 160.0f);
    if (newPx >= 12 && newPx <= 467 && newPy >= 42 && newPy <= 275)
    {
      uint16_t col = (stars[i].z < 100) ? TFT_WHITE : ((stars[i].z < 200) ? T.accent1 : T.textDark);
      tft.drawFastHLine(newPx, newPy, 2, col);
    }
  }
  tft.endWrite();
}

void renderDvdFrame(float dt)
{
  dvdAccumX += (float)dvdVX * DVD_SPEED_X * dt;
  dvdAccumY += (float)dvdVY * DVD_SPEED_Y * dt;
  int stepX = (int)dvdAccumX;
  int stepY = (int)dvdAccumY;
  dvdAccumX -= stepX;
  dvdAccumY -= stepY;

  int w = DVD_W, h = DVD_H, oldX = dvdX, oldY = dvdY;
  dvdX += stepX;
  dvdY += stepY;
  bool hit = false;
  if (dvdVX < 0 && dvdX <= 12)
  {
    dvdX = 12;
    dvdVX = 1;
    dvdAccumX = 0.0f;
    hit = true;
  }
  else if (dvdVX > 0 && dvdX + w >= 468)
  {
    dvdX = 468 - w;
    dvdVX = -1;
    dvdAccumX = 0.0f;
    hit = true;
  }
  if (dvdVY < 0 && dvdY <= 42)
  {
    dvdY = 42;
    dvdVY = 1;
    dvdAccumY = 0.0f;
    hit = true;
  }
  else if (dvdVY > 0 && dvdY + h >= 275)
  {
    dvdY = 275 - h;
    dvdVY = -1;
    dvdAccumY = 0.0f;
    hit = true;
  }
  if (hit)
  {
    uint16_t colors[] = {T.accent1, T.accent2, T.accent3, T.gold, T.tempCool, T.tempWarm};
    dvdColor = colors[random(0, 6)];
    buildDvdSprite();
  }

  // Clear only the parts of the old box that the new box does not cover.
  // Clearing the whole old box made the overlap blink every frame.
  int ix1 = max(oldX, dvdX);
  int iy1 = max(oldY, dvdY);
  int ix2 = min(oldX + w, dvdX + w);
  int iy2 = min(oldY + h, dvdY + h);
  tft.startWrite();
  if (ix1 < ix2 && iy1 < iy2)
  {
    if (oldY < iy1)
      tft.fillRect(oldX, oldY, w, iy1 - oldY, 0x0000);
    if (oldY + h > iy2)
      tft.fillRect(oldX, iy2, w, (oldY + h) - iy2, 0x0000);
    if (oldX < ix1)
      tft.fillRect(oldX, iy1, ix1 - oldX, iy2 - iy1, 0x0000);
    if (oldX + w > ix2)
      tft.fillRect(ix2, iy1, (oldX + w) - ix2, iy2 - iy1, 0x0000);
  }
  else
  {
    tft.fillRect(oldX, oldY, w, h, 0x0000);
  }
  tft.endWrite();

  if (dvdSpriteReady)
  {
    dvdSprite.pushSprite(dvdX, dvdY);
  }
  else
  {
    tft.fillRoundRect(dvdX, dvdY, w, h, 6, dvdColor);
    tft.setTextFont(2);
    tft.setTextColor(0x0000, dvdColor);
    drawCenteredText("CYD 3.5", dvdX + w / 2, dvdY + h / 2, 2);
  }
}

void renderAnimationFrame()
{
  unsigned long now = millis();
  float dt = (lastAnimUpdate == 0) ? (1.0f / 60.0f) : (float)(now - lastAnimUpdate) / 1000.0f;
  lastAnimUpdate = now;
  if (dt > 0.1f)
    dt = 0.1f;
  if (dt < 0.001f)
    dt = 0.001f;

  tft.setTextDatum(TL_DATUM);
  switch (currentAnim)
  {
  case 0:
    renderMatrixFrame(dt);
    break;
  case 1:
    renderStarfieldFrame(dt);
    break;
  case 2:
    renderDvdFrame(dt);
    break;
  }
  animFrameCount++;
  if (now - lastFpsTime >= 1000)
  {
    measuredFps = (float)animFrameCount * 1000.0 / (float)(now - lastFpsTime);
    animFrameCount = 0;
    lastFpsTime = now;
  }
  static unsigned long lastHudTime = 0;
  if (now - lastHudTime >= 500)
  {
    lastHudTime = now;
    tft.setTextFont(1);
    tft.setTextColor(T.accent3, 0x0821);
    tft.setCursor(24, 290);
    tft.printf("MODE: %s | FPS: %.1f | TAP SCREEN TO SWITCH ANIMATION", animNames[currentAnim], measuredFps);
  }
}

void showNetworkStatus(const char *title, const String &detail, uint16_t color)
{
  tft.fillRoundRect(40, 118, 400, 84, 10, T.headerBg);
  tft.drawRoundRect(40, 118, 400, 84, 10, color);
  tft.drawRoundRect(41, 119, 398, 82, 9, color);

  tft.setTextDatum(MC_DATUM);
  tft.setTextFont(4);
  tft.setTextColor(color, T.headerBg);
  tft.drawString(title, 240, 148);

  tft.setTextFont(1);
  tft.setTextColor(T.textMuted, T.headerBg);
  tft.drawString(fitText(detail, 360, 1), 240, 180);
  tft.setTextDatum(TL_DATUM);
}

int networkIndexAt(int x, int y)
{
  if (settingsTab != 0 || y < 82 || y > 254)
    return -1;

  int row = (y - 82) / 60;
  if (row < 0 || row > 2)
    return -1;
  int rowY = 82 + row * 60;
  if (y > rowY + 52)
    return -1;

  int col;
  if (x >= 16 && x <= 236)
    col = 0;
  else if (x >= 244 && x <= 464)
    col = 1;
  else
    return -1;

  int idx = row * 2 + col;
  return (idx < wifiProfileCount) ? idx : -1;
}

void drawNetworkSettings()
{
  tft.setTextDatum(TL_DATUM);
  int effectiveActive = -1;
  if (WiFi.status() == WL_CONNECTED)
  {
    String currentSsid = WiFi.SSID();
    if (activeProfile >= 0 && activeProfile < wifiProfileCount &&
        wifiProfiles[activeProfile].ssid == currentSsid)
      effectiveActive = activeProfile;
    else
      effectiveActive = findWifiProfile(currentSsid);
  }

  if (wifiProfileCount == 0)
  {
    tft.setTextDatum(MC_DATUM);
    tft.setTextFont(4);
    tft.setTextColor(T.textMuted, T.cardBg);
    tft.drawString("NO SAVED NETWORKS", 240, 148);
    tft.setTextFont(1);
    tft.setTextColor(T.textDark, T.cardBg);
    tft.drawString("USE ADD / CHANGE NETWORK BELOW", 240, 178);
    tft.setTextDatum(TL_DATUM);
  }

  for (int i = 0; i < wifiProfileCount; i++)
  {
    int col = i % 2;
    int row = i / 2;
    int sx = 16 + col * 228;
    int sy = 82 + row * 60;
    int sw = 220;
    int sh = 52;
    bool active = (i == effectiveActive);

    tft.fillRoundRect(sx, sy, sw, sh, 6, T.headerBg);
    tft.drawRoundRect(sx, sy, sw, sh, 6, active ? T.tempCool : T.cardBorder);
    if (active)
    {
      tft.drawRoundRect(sx + 1, sy + 1, sw - 2, sh - 2, 5, T.tempCool);
      tft.fillRoundRect(sx + 8, sy + 2, sw - 16, 2, 1, T.tempCool);
    }

    tft.setTextFont(2);
    tft.setTextColor(T.textWhite, T.headerBg);
    tft.drawString(fitText(wifiProfiles[i].ssid, 178, 2), sx + 10, sy + 7);

    String detail = wifiProfiles[i].url.length() ? wifiProfiles[i].url : String("NO SOURCE URL");
    tft.setTextFont(1);
    tft.setTextColor(active ? T.tempCool : T.textMuted, T.headerBg);
    tft.drawString(fitText(detail, 178, 1), sx + 10, sy + 28);

    tft.fillCircle(sx + sw - 14, sy + 14, 4, active ? T.tempCool : T.textDark);
    if (active)
      tft.drawCircle(sx + sw - 14, sy + 14, 6, T.tempCool);
  }

  tft.fillRoundRect(16, 262, 448, 26, 5, T.accent1);
  tft.setTextFont(2);
  tft.setTextColor(T.bg, T.accent1);
  drawCenteredText("ADD / CHANGE NETWORK", 240, 275, 2);
}

void drawThemeCard(int index, int sx, int sy)
{
  const ThemePalette *th = ALL_THEMES[index];
  bool isSelected = (index == selectedTheme);
  const int sw = 220;
  const int sh = 66;

  tft.fillRect(sx, sy, sw, sh, th->cardBg);
  uint16_t borderColor = isSelected ? T.gold : th->cardBorder;
  tft.drawRoundRect(sx, sy, sw, sh, 6, borderColor);
  if (isSelected)
  {
    tft.drawRoundRect(sx + 1, sy + 1, sw - 2, sh - 2, 5, T.gold);
    tft.fillRoundRect(sx + 4, sy + 10, 3, sh - 20, 1, T.gold);
  }

  tft.setTextFont(2);
  tft.setTextColor(isSelected ? T.gold : th->textWhite, th->cardBg);
  tft.drawString(th->name, sx + 12, sy + 5);

  uint16_t pal[15] = {th->bg, th->cardBg, th->cardBorder, th->headerBg, th->barTrack,
                      th->textWhite, th->textMuted, th->textDark, th->tempCool,
                      th->tempWarm, th->tempHot, th->accent1, th->accent2,
                      th->accent3, th->gold};
  for (int c = 0; c < 15; c++)
  {
    tft.fillRect(sx + 13 + c * 13, sy + 28, 12, 12, pal[c]);
    tft.drawRect(sx + 13 + c * 13, sy + 28, 12, 12, th->cardBorder);
  }

  tft.fillRect(sx + 12, sy + 44, 196, 14, th->headerBg);
  tft.drawRect(sx + 12, sy + 44, 196, 14, th->cardBorder);
  tft.setTextFont(1);
  tft.setTextColor(th->textMuted, th->headerBg);
  tft.drawString("BG CARD TXT STATUS ACC", sx + 16, sy + 47);
}

void drawThemeFooter()
{
  char hint[80];
  if (THEME_PAGES <= 1)
  {
    snprintf(hint, sizeof(hint), "TAP A THEME TO APPLY");
  }
  else
  {
    const char *action;
    if (themePage == 0)
      action = "SWIPE UP FOR MORE";
    else if (themePage == THEME_PAGES - 1)
      action = "SWIPE DOWN FOR PREVIOUS";
    else
      action = "SWIPE UP/DOWN FOR MORE";
    snprintf(hint, sizeof(hint), "%s  |  TAP TO APPLY  |  %d/%d",
             action, themePage + 1, THEME_PAGES);
  }
  tft.fillRect(16, 294, 448, 12, T.cardBg);
  tft.setTextFont(1);
  tft.setTextColor(T.textMuted, T.cardBg);
  drawCenteredText(hint, 240, 300, 1);
}

void drawThemeSettings()
{
  tft.setTextDatum(TL_DATUM);
  const int contentTop = 82;
  const int contentBottom = 290;
  const int contentLeft = 10;
  const int contentRight = 470;
  const int cardW = 220;
  const int cardH = 66;
  const int rowPitch = 70;
  const int colX[THEME_COLS] = {16, 244};

  // Paint only the gaps and empty cells. The cards are opaque, so this
  // avoids the full-area clear that made paging look like a flash.
  tft.fillRect(contentLeft, 80, contentRight - contentLeft, contentTop - 80, T.cardBg);
  const int gridBottom = contentTop + THEME_ROWS * rowPitch - (rowPitch - cardH);
  tft.fillRect(contentLeft, gridBottom, contentRight - contentLeft, contentBottom - gridBottom, T.cardBg);

  for (int row = 0; row < THEME_ROWS; row++)
  {
    int y = contentTop + row * rowPitch;
    tft.fillRect(contentLeft, y, colX[0] - contentLeft, cardH, T.cardBg);
    tft.fillRect(colX[0] + cardW, y, colX[1] - (colX[0] + cardW), cardH, T.cardBg);
    tft.fillRect(colX[1] + cardW, y, contentRight - (colX[1] + cardW), cardH, T.cardBg);
  }
  for (int row = 0; row < THEME_ROWS - 1; row++)
  {
    int gapY = contentTop + row * rowPitch + cardH;
    tft.fillRect(contentLeft, gapY, contentRight - contentLeft, rowPitch - cardH, T.cardBg);
  }

  int first = themePage * THEME_PAGE_SIZE;
  int last = min(first + THEME_PAGE_SIZE, TOTAL_THEMES);
  for (int i = first; i < last; i++)
  {
    int slot = i - first;
    int col = slot % THEME_COLS;
    int row = slot / THEME_COLS;
    drawThemeCard(i, colX[col], contentTop + row * rowPitch);
  }

  // The final page has fewer than six themes; clear the unused cells.
  for (int slot = last - first; slot < THEME_PAGE_SIZE; slot++)
  {
    int col = slot % THEME_COLS;
    int row = slot / THEME_COLS;
    tft.fillRect(colX[col], contentTop + row * rowPitch, cardW, cardH, T.cardBg);
  }

  // Page indicator on the right edge.
  int segmentH = 60;
  int segmentGap = 8;
  int totalH = THEME_PAGES * segmentH + (THEME_PAGES - 1) * segmentGap;
  int indicatorY = contentTop + (contentBottom - contentTop - totalH) / 2;
  for (int p = 0; p < THEME_PAGES; p++)
  {
    uint16_t color = (p == themePage) ? T.gold : T.cardBorder;
    tft.fillRoundRect(466, indicatorY + p * (segmentH + segmentGap), 4, segmentH, 2, color);
  }
}

void refreshThemePage()
{
  drawThemeFooter();
  drawThemeSettings();
}

void drawSettingsPage()
{
  tft.setTextDatum(TL_DATUM);
  tft.fillRoundRect(8, 36, 464, 279, 8, T.cardBg);

  const int tabY = 44;
  const int tabW = 220;
  const int tabH = 24;
  const int tabX[2] = {16, 244};

  for (int i = 0; i < 2; i++)
  {
    bool active = (settingsTab == i);
    uint16_t accent = (i == 0) ? T.accent3 : T.gold;

    if (active)
    {
      tft.fillRoundRect(tabX[i], tabY, tabW, tabH, 4, accent);
      tft.setTextColor(T.bg, accent);
    }
    else
    {
      tft.fillRoundRect(tabX[i], tabY, tabW, tabH, 4, T.headerBg);
      tft.drawRoundRect(tabX[i], tabY, tabW, tabH, 4, T.cardBorder);
      tft.setTextColor(T.textMuted, T.headerBg);
    }

    tft.setTextFont(2);
    drawCenteredText(i == 0 ? "NETWORKS" : "THEMES",
                     tabX[i] + tabW / 2, tabY + tabH / 2, 2);
  }

  tft.drawFastHLine(16, 78, 448, T.cardBorder);
  tft.drawFastHLine(16, 292, 448, T.cardBorder);

  tft.setTextFont(1);
  tft.setTextColor(T.textMuted, T.cardBg);
  if (settingsTab == 0)
    drawCenteredText("TAP A NETWORK TO CONNECT  |  HOLD TO FORGET", 240, 300, 1);
  else
    drawThemeFooter();

  tft.drawRoundRect(8, 36, 464, 279, 8, T.cardBorder);
  drawSettingsContent();
}

void drawSettingsContent()
{
  if (settingsTab == 0)
    drawNetworkSettings();
  else
    drawThemeSettings();
}

void switchPage(int newPage)
{
  if (newPage < 0 || newPage >= TOTAL_PAGES)
    return;
  currentPage = newPage;

  tft.fillRect(0, 32, 480, 288, T.bg);
  drawHeaderTabs();

  if (currentPage == 0)
  {
    drawMonitorPage();
    updateMonitorData();
  }
  else if (currentPage == 1)
  {
    drawClockPage();
    updateClockPage();
  }
  else if (currentPage == 2)
  {
    initAnimation();
  }
  else if (currentPage == 3)
  {
    drawSettingsPage();
  }
}

// =========================================================================
//  SETUP & MAIN LOOP
// =========================================================================
void setup()
{
  Serial.begin(115200);
  pinMode(BOOT_BTN_PIN, INPUT_PULLUP);

  prefs.begin("hwmon", false);
  configMutex = xSemaphoreCreateMutex();
  dataMutex = xSemaphoreCreateMutex();

  int savedTheme = prefs.getInt("theme", 0);
  applyTheme(savedTheme);

  setupAutoBrightness();

  tft.init();
  tft.setRotation(SCREEN_ROTATION);
  tft.invertDisplay(INVERT_DISPLAY);

  uint16_t calData[5] = {260, 3500, 300, 3500, 7};
  tft.setTouch(calData);

  graphSprite.setColorDepth(16);
  if (!graphSprite.createSprite(212, 104))
    Serial.println("Sprite error!");

  dvdSprite.setColorDepth(16);
  dvdSpriteReady = (dvdSprite.createSprite(DVD_W, DVD_H) != nullptr);
  if (!dvdSpriteReady)
    Serial.println("DVD sprite error!");

  for (int i = 0; i < HISTORY_LEN; i++)
  {
    cpuHistory[i] = 0.0;
    gpuHistory[i] = 0.0;
  }

  tft.fillScreen(T.bg);
  tft.drawRoundRect(20, 20, 440, 280, 12, T.cardBorder);
  tft.setTextDatum(MC_DATUM);
  tft.setTextFont(4);
  tft.setTextColor(T.accent1, T.bg);
  tft.drawString("CYD MONITOR", 240, 95);
  tft.setTextFont(2);
  tft.setTextColor(T.textMuted, T.bg);
  tft.drawString("Connecting to Wi-Fi...", 240, 142);
  tft.setTextFont(1);
  tft.drawString("Saved networks are tried automatically", 240, 170);
  tft.setTextDatum(TL_DATUM);

  setupWiFi();

  xTaskCreatePinnedToCore(httpFetchTask, "httpFetchTask", 12288, NULL, 1, &httpTaskHandle, 0);

  switchPage(0);
}

void loop()
{
  unsigned long currentMillis = millis();

  // ====== ALARM / BLINK CONTROL / AUTO-BRIGHTNESS ======
  if (pomodoroFinished)
  {
    if (millis() - pomodoroBlinkStart < 8000)
    {
      ledcWrite(PWM_CHAN, ((millis() / 250) % 2 == 0) ? 255 : 0);
    }
    else
    {
      pomodoroFinished = false;
    }
  }
  else
  {
    updateAutoBrightness();
  }

  // ====== TOUCH INPUT HANDLER ======
  // On the animation page, poll touch at 20 ms intervals so the touch
  // controller read does not stall every animation frame.
  static unsigned long lastTouchPoll = 0;
  bool pollTouch = (currentPage != 2) || (currentMillis - lastTouchPoll >= 20);
  if (pollTouch)
  {
    lastTouchPoll = currentMillis;
    auto handleTouch = [&]()
    {
  uint16_t rawTouchX = 0, rawTouchY = 0;
  bool isTouched = tft.getTouch(&rawTouchX, &rawTouchY);

  if (isTouched)
  {
    uint16_t currentX = rawTouchX;
    uint16_t currentY = (rawTouchY < 320) ? (319 - rawTouchY) : 0;

    if (!touchPressed)
    {
      touchPressed = true;
      lastTouchTime = currentMillis;
      touchStartX = currentX;
      touchStartY = currentY;
      lastTouchY = currentY;
      touchStartMillis = currentMillis;
      isDraggingSettings = false;
      longPressFired = false;

      if (pomodoroFinished)
        pomodoroFinished = false;
    }
    else
    {
      lastTouchY = currentY;
      if (currentPage == 3 &&
          abs((int)currentY - (int)touchStartY) > 12)
        isDraggingSettings = true;

      if (currentPage == 3 && settingsTab == 0 && !isDraggingSettings &&
          !longPressFired && (currentMillis - touchStartMillis > 800))
      {
        int idx = networkIndexAt(touchStartX, touchStartY);
        if (idx >= 0)
        {
          longPressFired = true;
          String forgotten = wifiProfiles[idx].ssid;
          removeWifiProfile(idx);
          showNetworkStatus("NETWORK FORGOTTEN", forgotten, T.tempWarm);
          delay(700);
          drawSettingsPage();
        }
      }
    }
  }
  else
  {
    if (touchPressed)
    {
      touchPressed = false;
      uint16_t touchX = touchStartX, touchY = touchStartY;

      // Header Navigation
      if (touchY <= 40)
      {
        if (touchX >= 2 && touchX <= 376)
        {
          int tab = (touchX - 2) / 94;
          if (tab >= 0 && tab < TOTAL_PAGES)
            switchPage(tab);
        }
      }
      // Page 0: Monitor Subpage Switch & Ping Target Switch
      else if (currentPage == 0)
      {
        if (touchY >= 285 && touchY <= 315 && touchX >= 310)
        {
          monitorSubPage = (monitorSubPage == 0) ? 1 : 0;
          drawMonitorPage();
          updateMonitorData();
        }
        else if (monitorSubPage == 1 && touchY >= 82 && touchY <= 182 && touchX >= 244 && touchX <= 464)
        {
          // Tap the latency card to cycle the ping target.
          currentPingTargetIdx = (currentPingTargetIdx + 1) % TOTAL_PING_TARGETS;
          updateMonitorData();
        }
      }
      // Clock Controls
      else if (currentPage == 1)
      {
        if (clockSubPage == 0)
        {
          if (touchY >= 40 && touchY <= 75 && touchX >= 310)
          {
            clockSubPage = 1;
            drawClockPage();
          }
        }
        else
        {
          if (touchY >= 40 && touchY <= 75 && touchX >= 330)
          {
            clockSubPage = 0;
            drawClockPage();
          }
          else if (touchY >= 90 && touchY <= 145)
          {
            if (touchX >= 25 && touchX < 80 && !pomodoroActive && pomodoroMinutes > 1)
            {
              pomodoroMinutes--;
              drawClockPage();
            }
            else if (touchX >= 395 && touchX < 455 && !pomodoroActive && pomodoroMinutes < 60)
            {
              pomodoroMinutes++;
              drawClockPage();
            }
          }
          else if (touchY >= 175 && touchY <= 220 && !pomodoroActive)
          {
            if (touchX >= 30 && touchX < 120)
              pomodoroMinutes = 10;
            else if (touchX >= 140 && touchX < 230)
              pomodoroMinutes = 15;
            else if (touchX >= 250 && touchX < 340)
              pomodoroMinutes = 25;
            else if (touchX >= 360 && touchX < 450)
              pomodoroMinutes = 45;
            drawClockPage();
          }
          else if (touchY >= 235 && touchY <= 285)
          {
            if (touchX >= 75 && touchX < 235)
            {
              if (!pomodoroActive)
              {
                pomodoroActive = true;
                pomodoroPaused = false;
                pomodoroEndMillis = millis() + ((pomodoroRemainingMs == 0) ? ((unsigned long)pomodoroMinutes * 60000) : pomodoroRemainingMs);
              }
              else
              {
                pomodoroActive = false;
                pomodoroPaused = true;
                if (pomodoroEndMillis > millis())
                  pomodoroRemainingMs = pomodoroEndMillis - millis();
              }
              drawClockPage();
            }
            else if (touchX >= 245 && touchX < 405)
            {
              pomodoroActive = false;
              pomodoroPaused = false;
              pomodoroFinished = false;
              pomodoroRemainingMs = 0;
              drawClockPage();
            }
          }
        }
      }
      // Animation Switch
      else if (currentPage == 2 && touchY > 40)
      {
        currentAnim = (currentAnim + 1) % TOTAL_ANIMS;
        initAnimation();
      }
      // Settings: network cards, add/change portal, theme selection
      else if (currentPage == 3 && !longPressFired)
      {
        if (touchY >= 44 && touchY <= 68)
        {
          if (touchX >= 16 && touchX <= 236 && settingsTab != 0)
          {
            settingsTab = 0;
            drawSettingsPage();
          }
          else if (touchX >= 244 && touchX <= 464 && settingsTab != 1)
          {
            settingsTab = 1;
            themePage = 0;
            drawSettingsPage();
          }
        }
        else if (settingsTab == 0 && !isDraggingSettings)
        {
          if (touchY >= 262 && touchY <= 288 && touchX >= 16 && touchX <= 464)
          {
            showNetworkStatus("OPENING PORTAL", String("AP: ") + WIFI_AP_SSID, T.gold);
            bool ok = startConfigPortal();
            if (ok)
            {
              showNetworkStatus("NETWORK SAVED", "CONNECTED", T.tempCool);
              delay(900);
            }
            else
            {
              showNetworkStatus("PORTAL CLOSED", "NO CHANGES SAVED", T.tempHot);
              delay(1000);
            }
            drawSettingsPage();
          }
          else
          {
            int idx = networkIndexAt(touchX, touchY);
            if (idx >= 0)
            {
              int previous = activeProfile;
              showNetworkStatus("CONNECTING...", wifiProfiles[idx].ssid, T.gold);
              bool ok = connectProfile(idx, 12000);
              if (ok)
              {
                String detail = wifiProfiles[idx].url.length()
                                    ? wifiProfiles[idx].url
                                    : String("SOURCE UNCHANGED");
                showNetworkStatus("CONNECTED", detail, T.tempCool);
                delay(900);
              }
              else
              {
                showNetworkStatus("CONNECTION FAILED", "RESTORING PREVIOUS LINK", T.tempHot);
                delay(800);
                if (previous >= 0 && previous != idx)
                  connectProfile(previous, 8000);
              }
              drawSettingsPage();
            }
          }
        }
        else if (settingsTab == 1)
        {
          int swipe = (int)touchStartY - (int)lastTouchY; // positive = swipe up
          if (isDraggingSettings && abs(swipe) >= 20)
          {
            int newPage = constrain(themePage + (swipe > 0 ? 1 : -1), 0, THEME_PAGES - 1);
            if (newPage != themePage)
            {
              themePage = newPage;
              refreshThemePage();
            }
          }
          else if (!isDraggingSettings && touchY >= 82 && touchY <= 290)
          {
            int slotRow = (touchY - 82) / 70;
            int col = (touchX >= 238) ? 1 : 0;
            int cardX = col ? 244 : 16;
            int cardY = 82 + slotRow * 70;
            int slot = slotRow * 2 + col;
            int tappedTheme = themePage * THEME_PAGE_SIZE + slot;
            if (slotRow >= 0 && slotRow < THEME_ROWS &&
                touchY >= cardY && touchY <= cardY + 66 &&
                touchX >= cardX && touchX <= cardX + 220 &&
                tappedTheme >= 0 && tappedTheme < TOTAL_THEMES &&
                tappedTheme != selectedTheme)
            {
              applyTheme(tappedTheme);
              tft.fillScreen(T.bg);
              drawHeaderTabs();
              drawSettingsPage();
            }
          }
        }
      }
    }
  }
    };
    handleTouch();
  }

  // ====== BOOT BUTTON ======
  bool currentBtn = (digitalRead(BOOT_BTN_PIN) == LOW);
  if (currentBtn && (lastBtnState == HIGH) && (currentMillis - lastBtnPress > 250))
  {
    lastBtnPress = currentMillis;
    switchPage((currentPage + 1) % TOTAL_PAGES);
  }
  lastBtnState = currentBtn;

  // ====== PAGE RENDERING ======
  static unsigned long lastHeaderTick = 0;
  if (currentPage == 0)
  {
    if (dataUpdated)
    {
      dataUpdated = false;
      updateMonitorData();
    }
    if (currentMillis - lastHeaderTick >= 1000)
    {
      lastHeaderTick = currentMillis;
      updateHeaderWifi();
      if (monitorSubPage == 1) updateMonitorData();
    }
    delay(10);
  }
  else if (currentPage == 1)
  {
    static unsigned long lastClockAnim = 0;
    static int lastClockSec = -1;
    if (currentMillis - lastClockAnim >= 35)
    {
      lastClockAnim = currentMillis;
      time_t now;
      time(&now);
      struct tm timeinfo;
      localtime_r(&now, &timeinfo);
      bool secChanged = (timeinfo.tm_sec != lastClockSec);
      if (secChanged)
        lastClockSec = timeinfo.tm_sec;
      updateClockPage(secChanged);
    }
    if (currentMillis - lastHeaderTick >= 1000)
    {
      lastHeaderTick = currentMillis;
      updateHeaderWifi();
    }
    delay(5);
  }
  else if (currentPage == 2)
  {
    // Motion is time-based, so raising the render rate does not speed up the
    // animations. The 5 ms floor only prevents redundant back-to-back draws.
    static unsigned long lastAnimFrame = 0;
    if (currentMillis - lastAnimFrame >= 5)
    {
      lastAnimFrame = currentMillis;
      renderAnimationFrame();
    }
    if (currentMillis - lastHeaderTick >= 1000)
    {
      lastHeaderTick = currentMillis;
      updateHeaderWifi();
    }
    yield();
  }
  else if (currentPage == 3)
  {
    if (currentMillis - lastHeaderTick >= 1000)
    {
      lastHeaderTick = currentMillis;
      updateHeaderWifi();
    }
    delay(30);
  }
}