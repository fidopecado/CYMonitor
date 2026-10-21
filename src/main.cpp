#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <TFT_eSPI.h>
#include <Preferences.h>
#include <AnimatedGIF.h>
#include <WiFiManager.h> // Library Captive Portal WiFi
#include "time.h"
#include "gif_data.h" // File data GIF

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
AnimatedGIF gif;
bool gifIsOpen = false;

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

// Settings Page Scroll
int settingsScrollY = 0;
int dragStartY = 0;
int startScrollY = 0;
bool isDraggingSettings = false;
#define MAX_SETTINGS_SCROLL 360

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
//  NETWORK & SENSOR CONFIGURATION
// =========================================================================
char serverUrl[128] = "http://192.168.1.50:8085/data.json"; // URL Dinamis via WiFiManager

const char *ntpServer = "pool.ntp.org";
const long gmtOffset_sec = 7 * 3600; // WIB (GMT+7)
const int daylightOffset_sec = 0;

// LibreHardwareMonitor Sensor IDs
const String CPU_TEMP_ID = "/amdcpu/0/temperature/2";
const String CPU_LOAD_ID = "/amdcpu/0/load/0";
const String CPU_POWER_ID = "/amdcpu/0/power/0";
const String CPU_FAN_ID = "/lpc/nct6779d/0/fan/1";

const String GPU_CORE_ID = "/gpu-amd/0/temperature/0";
const String GPU_HOTSPOT_ID = "/gpu-amd/0/temperature/7";
const String GPU_LOAD_ID = "/gpu-amd/0/load/0";
const String GPU_VRAM_ID = "/gpu-amd/0/smalldata/0";

const String RAM_LOAD_ID = "/ram/load/0";
const String RAM_USED_ID = "/ram/data/0";
const String RAM_AVAIL_ID = "/ram/data/1";

TaskHandle_t httpTaskHandle = NULL;
volatile unsigned long lastSuccessFetch = 0;
volatile bool dataUpdated = false;

Preferences prefs;

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

// =========================================================================
//  DATA BUFFERS
// =========================================================================
float currentCpuTemp = 0.0, currentCpuLoad = 0.0, currentCpuPower = 0.0;
int currentCpuFan = 0;
float currentGpuCore = 0.0, currentGpuHot = 0.0, currentGpuLoad = 0.0, currentGpuVram = 0.0;
float currentRamLoad = 0.0, currentRamUsed = 0.0, currentRamTotal = 16.0;

#define HISTORY_LEN 40
float cpuHistory[HISTORY_LEN];
float gpuHistory[HISTORY_LEN];
int historyCount = 0;

// =========================================================================
//  ANIMATION PAGE STATE
// =========================================================================
int currentAnim = 0;
const int TOTAL_ANIMS = 4;
const char *animNames[4] = {"MATRIX RAIN", "STARFIELD 3D", "BOUNCING DVD", "GIF ANIMATION"};

#define MATRIX_COLS 36
int matrixY[MATRIX_COLS], matrixSpeed[MATRIX_COLS], matrixLen[MATRIX_COLS];

#define NUM_STARS 50
struct Star
{
  float x, y, z;
};
Star stars[NUM_STARS];

int dvdX = 100, dvdY = 100, dvdVX = 3, dvdVY = 2;
uint16_t dvdColor = 0x07FF;

unsigned long animFrameCount = 0, lastFpsTime = 0;
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
//  GIF DRAW CALLBACK
// =========================================================================
void GIFDraw(GIFDRAW *pDraw)
{
  uint8_t *s;
  uint16_t *palette;
  int x, y, iWidth;

  int offsetX = (480 - pDraw->iWidth) / 2;
  int offsetY = 36 + (240 - pDraw->iHeight) / 2;

  palette = pDraw->pPalette;
  s = pDraw->pPixels;
  iWidth = pDraw->iWidth;

  if (pDraw->y >= pDraw->iHeight)
    return;

  y = pDraw->iY + pDraw->y;
  x = pDraw->iX;

  if (pDraw->ucHasTransparency)
  {
    uint8_t ucTransparent = pDraw->ucTransparent;
    int iCount = 0;
    uint16_t usPixels[320];
    int iX = pDraw->iX;

    for (int i = 0; i < iWidth; i++)
    {
      if (s[i] == ucTransparent)
      {
        if (iCount > 0)
        {
          tft.pushImage(offsetX + iX, offsetY + y, iCount, 1, usPixels);
          iCount = 0;
        }
        iX = pDraw->iX + i + 1;
      }
      else
      {
        usPixels[iCount++] = palette[s[i]];
      }
    }
    if (iCount > 0)
    {
      tft.pushImage(offsetX + iX, offsetY + y, iCount, 1, usPixels);
    }
  }
  else
  {
    uint16_t usPixels[320];
    for (int i = 0; i < iWidth; i++)
    {
      usPixels[i] = palette[s[i]];
    }
    tft.pushImage(offsetX + x, offsetY + y, iWidth, 1, usPixels);
  }
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
//  HELPER FUNCTIONS
// =========================================================================
float parseFloatValue(String str)
{
  str.replace(",", ".");
  int start = -1;
  for (unsigned int i = 0; i < str.length(); i++)
  {
    if (isDigit(str[i]) || str[i] == '-' || str[i] == '.')
    {
      start = i;
      break;
    }
  }
  if (start == -1)
    return 0.0;
  return str.substring(start).toFloat();
}

String findSensorBySensorId(JsonVariant node, const String &targetSensorId)
{
  if (node.is<JsonObject>())
  {
    JsonObject obj = node.as<JsonObject>();
    if (obj["SensorId"].as<String>() == targetSensorId && !obj["Value"].isNull())
    {
      return obj["Value"].as<String>();
    }
    if (obj["Children"].is<JsonArray>())
    {
      for (JsonVariant child : obj["Children"].as<JsonArray>())
      {
        String val = findSensorBySensorId(child, targetSensorId);
        if (val != "")
          return val;
      }
    }
  }
  return "";
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

void drawDegreeC(int x, int y, uint16_t color, uint16_t bgColor)
{
  tft.setTextPadding(0);
  tft.drawCircle(x + 3, y + 4, 3, color);
  tft.drawCircle(x + 3, y + 4, 2, color);
  tft.setTextFont(4);
  tft.setTextColor(color, bgColor);
  tft.drawString("C", x + 9, y);
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
//  HTTP BACKGROUND FETCH TASK (CORE 0)
// =========================================================================
void httpFetchTask(void *pvParameters)
{
  for (;;)
  {
    if (currentPage == 0 && monitorSubPage == 0 && WiFi.status() == WL_CONNECTED)
    {
      HTTPClient http;
      http.begin(serverUrl);
      http.setTimeout(2000);

      int httpCode = http.GET();
      if (httpCode == HTTP_CODE_OK)
      {
        JsonDocument doc;
        DeserializationError error = deserializeJson(doc, http.getStream(), DeserializationOption::NestingLimit(30));

        if (!error)
        {
          currentCpuTemp = parseFloatValue(findSensorBySensorId(doc.as<JsonVariant>(), CPU_TEMP_ID));
          currentCpuLoad = parseFloatValue(findSensorBySensorId(doc.as<JsonVariant>(), CPU_LOAD_ID));
          currentCpuPower = parseFloatValue(findSensorBySensorId(doc.as<JsonVariant>(), CPU_POWER_ID));
          currentCpuFan = (int)parseFloatValue(findSensorBySensorId(doc.as<JsonVariant>(), CPU_FAN_ID));

          currentGpuCore = parseFloatValue(findSensorBySensorId(doc.as<JsonVariant>(), GPU_CORE_ID));
          currentGpuHot = parseFloatValue(findSensorBySensorId(doc.as<JsonVariant>(), GPU_HOTSPOT_ID));
          currentGpuLoad = parseFloatValue(findSensorBySensorId(doc.as<JsonVariant>(), GPU_LOAD_ID));
          currentGpuVram = parseFloatValue(findSensorBySensorId(doc.as<JsonVariant>(), GPU_VRAM_ID));

          currentRamLoad = parseFloatValue(findSensorBySensorId(doc.as<JsonVariant>(), RAM_LOAD_ID));
          currentRamUsed = parseFloatValue(findSensorBySensorId(doc.as<JsonVariant>(), RAM_USED_ID));
          float ramAvail = parseFloatValue(findSensorBySensorId(doc.as<JsonVariant>(), RAM_AVAIL_ID));
          if (currentRamUsed > 0.0 && ramAvail > 0.0)
            currentRamTotal = currentRamUsed + ramAvail;

          static unsigned long lastHistoryPush = 0;
          if (millis() - lastHistoryPush >= 1000)
          {
            lastHistoryPush = millis();
            pushHistory(cpuHistory, currentCpuTemp);
            pushHistory(gpuHistory, currentGpuCore);
          }

          lastSuccessFetch = millis();
          dataUpdated = true;
        }
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

  for (int i = 0; i < TOTAL_PAGES; i++)
  {
    int tx = i * 95, ty = 4, tw = 95, th = 28;
    if (i == currentPage)
    {
      tft.fillRect(tx, ty, tw, th + 2, T.cardBg);
      tft.drawRect(tx, ty, tw, th + 2, T.cardBorder);
      tft.fillRect(tx + 1, ty, tw - 2, 3, tabAccents[i]);
      tft.drawFastHLine(tx + 1, 32, tw - 2, T.cardBg);

      tft.setTextFont(2);
      tft.setTextColor(T.textWhite, T.cardBg);
      tft.drawCentreString(tabNames[i], tx + tw / 2, ty + 6, 2);
    }
    else
    {
      tft.fillRect(tx, ty + 3, tw, th - 3, T.headerBg);
      tft.drawRect(tx, ty + 3, tw, th - 3, T.cardBorder);

      tft.setTextFont(2);
      tft.setTextColor(T.textMuted, T.headerBg);
      tft.drawCentreString(tabNames[i], tx + tw / 2, ty + 7, 2);
    }
  }
  updateHeaderWifi();
}

void updateHeaderWifi()
{
  int x = 390, y = 10;
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

void drawSparklineGraph(int x, int y, int w, int h, float *history, uint16_t lineColor)
{
  if (!graphSprite.created())
    return;

  graphSprite.fillSprite(T.cardBg);
  graphSprite.drawRect(0, 0, w, h, T.cardBorder);
  graphSprite.drawFastHLine(1, h / 2, w - 2, T.cardBorder);

  if (historyCount < 2)
  {
    graphSprite.setTextFont(1);
    graphSprite.setTextColor(T.textMuted, T.cardBg);
    graphSprite.drawString("Collecting samples...", 30, h / 2 - 4);
    graphSprite.pushSprite(x, y);
    return;
  }

  float minVal = 120.0, maxVal = -10.0;
  for (int i = 0; i < HISTORY_LEN; i++)
  {
    if (history[i] > 0.0)
    {
      if (history[i] < minVal)
        minVal = history[i];
      if (history[i] > maxVal)
        maxVal = history[i];
    }
  }
  if (maxVal - minVal < 8.0)
  {
    maxVal += 4.0;
    minVal -= 4.0;
  }

  int prevPx = -1, prevPy = -1;
  float stepX = (float)(w - 4) / (float)(HISTORY_LEN - 1);

  for (int i = 0; i < HISTORY_LEN; i++)
  {
    if (history[i] <= 0.0)
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

  graphSprite.setTextFont(1);
  graphSprite.setTextColor(T.textMuted, T.cardBg);
  graphSprite.setCursor(4, 3);
  graphSprite.printf("%.0fC", maxVal);
  graphSprite.setCursor(4, h - 10);
  graphSprite.printf("%.0fC", minVal);
  graphSprite.pushSprite(x, y);
}

void drawMonitorPage()
{
  tft.fillRect(0, 32, 480, 288, T.bg);

  if (monitorSubPage == 0) {
    // SUBPAGE 0: HARDWARE MONITOR (CPU/GPU/RAM)
    tft.fillRoundRect(8, 36, 228, 210, 8, T.cardBg);
    tft.drawRoundRect(8, 36, 228, 210, 8, T.cardBorder);
    tft.fillRoundRect(16, 43, 38, 18, 4, T.accent1);
    tft.setTextFont(2);
    tft.setTextColor(T.bg, T.accent1);
    tft.drawString("CPU", 22, 44);
    tft.setTextFont(1);
    tft.setTextColor(T.textMuted, T.cardBg);
    tft.drawString("AMD RYZEN 5 5600", 60, 48);

    tft.fillRoundRect(244, 36, 228, 210, 8, T.cardBg);
    tft.drawRoundRect(244, 36, 228, 210, 8, T.cardBorder);
    tft.fillRoundRect(252, 43, 38, 18, 4, T.accent2);
    tft.setTextFont(2);
    tft.setTextColor(T.bg, T.accent2);
    tft.drawString("GPU", 258, 44);
    tft.setTextFont(1);
    tft.setTextColor(T.textMuted, T.cardBg);
    tft.drawString("RX 6700 XT", 296, 48);

    tft.fillRoundRect(8, 251, 464, 64, 8, T.cardBg);
    tft.drawRoundRect(8, 251, 464, 64, 8, T.cardBorder);
    tft.fillRoundRect(16, 257, 44, 16, 4, T.accent3);
    tft.setTextFont(2);
    tft.setTextColor(T.bg, T.accent3);
    tft.drawString("RAM", 25, 257);
    tft.setTextFont(1);
    tft.setTextColor(T.textMuted, T.cardBg);
    tft.drawString("SYSTEM MEMORY", 68, 260);

    tft.setCursor(16, 299);
    tft.print("ENDPOINT: ");
    tft.print(serverUrl);

    tft.fillRoundRect(320, 292, 144, 20, 4, T.accent2);
    tft.setTextFont(2); tft.setTextColor(T.bg, T.accent2);
    tft.drawCentreString("WIFI DIAG >", 392, 294, 2);

  } else {
    // SUBPAGE 1: WIFI DIAGNOSTIC HUB (TEKS STATIS HANYA DIGAMBAR ONCE)
    tft.fillRoundRect(8, 36, 464, 274, 8, T.cardBg);
    tft.drawRoundRect(8, 36, 464, 274, 8, T.cardBorder);

    tft.fillRoundRect(16, 44, 150, 22, 4, T.accent1);
    tft.setTextFont(2); tft.setTextColor(T.bg, T.accent1);
    tft.drawString("WIFI DIAGNOSTICS", 22, 46);

    tft.drawFastHLine(16, 72, 448, T.cardBorder);

    // Card 1 Static: Link Quality
    tft.fillRect(16, 78, 220, 100, T.headerBg);
    tft.drawRoundRect(16, 78, 220, 100, 6, T.cardBorder);
    tft.setTextFont(2); tft.setTextColor(T.gold, T.headerBg);
    tft.drawString("LINK QUALITY", 26, 85);

    // Card 2 Static: Latency & Ping
    tft.fillRect(244, 78, 220, 100, T.headerBg);
    tft.drawRoundRect(244, 78, 220, 100, 6, T.cardBorder);
    tft.setTextFont(2); tft.setTextColor(T.gold, T.headerBg);
    tft.drawString("LATENCY (PING)", 254, 85);

    // Card 3 Static: Network Identity (Teks Statis DIGAMBAR SEKALI DI SINI)
    tft.fillRect(16, 186, 448, 95, T.headerBg);
    tft.drawRoundRect(16, 186, 448, 95, 6, T.cardBorder);
    tft.setTextFont(2); tft.setTextColor(T.accent3, T.headerBg);
    tft.drawString("NETWORK CONFIGURATION", 26, 193);

    tft.setTextFont(1); tft.setTextColor(T.textMuted, T.headerBg);
    tft.setCursor(26, 218); tft.printf("LOCAL IP    : %s", WiFi.localIP().toString().c_str());
    tft.setCursor(26, 236); tft.printf("GATEWAY IP  : %s", WiFi.gatewayIP().toString().c_str());
    tft.setCursor(26, 254); tft.printf("SUBNET MASK : %s", WiFi.subnetMask().toString().c_str());

    tft.setCursor(260, 218); tft.printf("MAC ADDRESS : %s", WiFi.macAddress().c_str());
    tft.setCursor(260, 236); tft.printf("DNS SERVER  : %s", WiFi.dnsIP().toString().c_str());

    // Footer Info & Tombol Switch
    tft.setTextFont(1); tft.setTextColor(T.textMuted, T.cardBg);
    tft.drawString("TAP PING CARD TO SWITCH TARGET", 16, 297);

    tft.fillRoundRect(320, 292, 144, 20, 4, T.accent1);
    tft.setTextFont(2); tft.setTextColor(T.bg, T.accent1);
    tft.drawCentreString("< HARDWARE", 392, 294, 2);
  }
}

void updateMonitorData()
{
  if (monitorSubPage == 0) {
    // CPU CARD
    uint16_t cpuColor = getTempColor(currentCpuTemp);
    char cpuBuff[16];
    if (currentCpuTemp > 0.0)
      snprintf(cpuBuff, sizeof(cpuBuff), "%.1f", currentCpuTemp);
    else
      snprintf(cpuBuff, sizeof(cpuBuff), "--.-");

    int numWidth = tft.textWidth(cpuBuff, 6);
    tft.fillRect(16, 65, 126, 46, T.cardBg);
    tft.setTextFont(6);
    tft.setTextColor(cpuColor, T.cardBg);
    tft.drawString(cpuBuff, 16, 65);

    drawDegreeC(16 + numWidth + 3, 71, T.textMuted, T.cardBg);
    drawTrendBadge(148, 75, getTrendDelta(cpuHistory), T.cardBg);

    tft.setTextFont(1);
    tft.setTextColor(T.textMuted, T.cardBg);
    tft.setCursor(16, 117);
    tft.printf("LOAD: %.1f%%", currentCpuLoad);
    drawMiniBar(80, 119, 60, 6, currentCpuLoad, 100.0, getUsageColor(currentCpuLoad));

    tft.setCursor(150, 117);
    if (currentCpuFan > 0)
      tft.printf("%d RPM", currentCpuFan);
    else if (currentCpuPower > 0.0)
      tft.printf("%.0f W", currentCpuPower);
    else
      tft.print("-- W");

    drawSparklineGraph(16, 133, 212, 104, cpuHistory, T.accent1);

    // GPU CARD
    uint16_t gpuColor = getTempColor(currentGpuCore);
    char gpuBuff[16];
    if (currentGpuCore > 0.0)
      snprintf(gpuBuff, sizeof(gpuBuff), "%.1f", currentGpuCore);
    else
      snprintf(gpuBuff, sizeof(gpuBuff), "--.-");

    int gpuNumWidth = tft.textWidth(gpuBuff, 6);
    tft.fillRect(252, 65, 126, 46, T.cardBg);
    tft.setTextFont(6);
    tft.setTextColor(gpuColor, T.cardBg);
    tft.drawString(gpuBuff, 252, 65);

    drawDegreeC(252 + gpuNumWidth + 3, 71, T.textMuted, T.cardBg);

    uint16_t hsBg = (currentGpuHot >= 85.0) ? T.tempHot : T.cardBorder;
    tft.fillRoundRect(368, 43, 96, 18, 4, hsBg);
    tft.setTextFont(1);
    tft.setTextColor((currentGpuHot >= 85.0) ? T.textWhite : T.gold, hsBg);
    tft.setCursor(374, 48);
    if (currentGpuHot > 0.0)
      tft.printf("HOT: %.1fC", currentGpuHot);
    else
      tft.print("HOT: --.-C");

    drawTrendBadge(384, 75, getTrendDelta(gpuHistory), T.cardBg);

    tft.setTextFont(1);
    tft.setTextColor(T.textMuted, T.cardBg);
    tft.setCursor(252, 117);
    tft.printf("LOAD: %.1f%%", currentGpuLoad);
    drawMiniBar(316, 119, 60, 6, currentGpuLoad, 100.0, getUsageColor(currentGpuLoad));

    tft.setCursor(386, 117);
    if (currentGpuVram > 1024.0)
      tft.printf("VRAM: %.1fGB", currentGpuVram / 1024.0);
    else if (currentGpuVram > 0.0)
      tft.printf("VRAM: %.0fMB", currentGpuVram);
    else
      tft.print("VRAM: --");

    drawSparklineGraph(252, 133, 212, 104, gpuHistory, T.accent2);

    // RAM CARD
    tft.setTextFont(1);
    tft.setTextColor(T.accent1, T.cardBg);
    tft.setCursor(180, 260);
    if (currentRamUsed > 0.0)
      tft.printf("%.1f GB / %.1f GB", currentRamUsed, currentRamTotal);
    else
      tft.print("N/A GB");

    uint16_t ramColor = getUsageColor(currentRamLoad);
    tft.setTextFont(2);
    tft.setTextColor(ramColor, T.cardBg);
    tft.setCursor(330, 257);
    if (currentRamLoad > 0.0)
      tft.printf("%.1f%%", currentRamLoad);
    else
      tft.print("--.-%");

    tft.setTextFont(1);
    tft.setTextColor(T.textMuted, T.cardBg);
    tft.setCursor(396, 260);
    if (currentCpuPower > 0.0)
      tft.printf("PWR: %.1fW", currentCpuPower);

    drawMiniBar(16, 279, 448, 8, currentRamLoad, 100.0, ramColor);

  } else {
    // 1. AMBIL DATA & LAKUKAN PING RINGAN
    long rssi = WiFi.RSSI();
    int signalPct = constrain(2 * (rssi + 100), 0, 100);

    long pingGw = measureLatency(WiFi.gatewayIP().toString().c_str(), 80);
    long pingTarget = measureLatency(PING_TARGETS[currentPingTargetIdx].host, PING_TARGETS[currentPingTargetIdx].port);

    // 2. UPDATE KONTEN HANYA PADA TEKS VARIABEL BERUBAH (PEMBERSIHAN PRESISI AREA TEKS)

    // --- Card 1 Values ---
    tft.fillRect(26, 110, 85, 45, T.headerBg);
    tft.setTextFont(6); tft.setTextColor(T.accent1, T.headerBg);
    tft.setCursor(26, 110); tft.printf("%d%%", signalPct);

    tft.fillRect(120, 110, 110, 55, T.headerBg);
    tft.setTextFont(1); tft.setTextColor(T.textMuted, T.headerBg);
    tft.setCursor(120, 112); tft.printf("RSSI: %d dBm", (int)rssi);
    tft.setCursor(120, 130); tft.printf("CH  : %d", WiFi.channel());
    tft.setCursor(120, 148); tft.printf("SSID: %s", WiFi.SSID().substring(0, 10).c_str());

    // --- Card 2 Values ---
    tft.fillRect(254, 104, 204, 14, T.headerBg);
    tft.setTextFont(1); tft.setTextColor(T.gold, T.headerBg);
    tft.setCursor(254, 106); tft.printf("TARGET: %s", PING_TARGETS[currentPingTargetIdx].name);

    tft.fillRect(254, 122, 204, 45, T.headerBg);
    tft.setTextFont(2); tft.setTextColor(T.textWhite, T.headerBg);
    tft.setCursor(254, 124);
    if (pingGw >= 0) tft.printf("GATEWAY : %ld ms", pingGw);
    else tft.print("GATEWAY : TIMEOUT");

    tft.setCursor(254, 146);
    if (pingTarget >= 0) tft.printf("SERVER  : %ld ms", pingTarget);
    else tft.print("SERVER  : TIMEOUT");
  }
}

void drawClockPage()
{
  forceSubPageRefresh = true;
  tft.fillRoundRect(8, 36, 464, 274, 8, T.cardBg);
  tft.drawRoundRect(8, 36, 464, 274, 8, T.cardBorder);
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
    tft.fillRoundRect(320, 44, 144, 26, 6, T.accent2);
    tft.setTextFont(2);
    tft.setTextColor(T.bg, T.accent2);
    tft.drawString("POMODORO HUB >", 392, 57);
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
    tft.fillRoundRect(336, 44, 128, 26, 6, T.accent1);
    tft.setTextFont(2);
    tft.setTextColor(T.bg, T.accent1);
    tft.drawString("< CLOCK MODE", 400, 57);
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
      tft.fillRoundRect(150, 44, 170, 24, 4, badgeBg);
      tft.setTextFont(2);
      tft.setTextColor(pomodoroFinished ? T.textWhite : (pomodoroActive ? T.bg : T.textMuted), badgeBg);
      tft.drawString(pomodoroFinished ? "BREAK TIME!" : (pomodoroActive ? "FOCUSING" : "READY"), 235, 56);

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

void initAnimation()
{
  if (gifIsOpen)
  {
    gif.close();
    gifIsOpen = false;
  }
  tft.fillRoundRect(8, 36, 464, 279, 8, 0x0000);
  tft.drawRoundRect(8, 36, 464, 279, 8, T.cardBorder);
  tft.fillRect(16, 282, 448, 24, 0x0821);
  tft.drawRect(16, 282, 448, 24, T.accent3);

  if (currentAnim == 0)
  {
    for (int i = 0; i < MATRIX_COLS; i++)
    {
      matrixY[i] = random(44, 180);
      matrixSpeed[i] = random(4, 9);
      matrixLen[i] = random(6, 14);
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
    dvdVX = 3;
    dvdVY = 2;
    dvdColor = T.accent1;
  }
  else if (currentAnim == 3)
  {
    gif.begin(GIF_PALETTE_RGB565_BE);
    if (gif.open((uint8_t *)my_gif_data, my_gif_size, GIFDraw))
      gifIsOpen = true;
  }
  animFrameCount = 0;
  lastFpsTime = millis();
}

void renderMatrixFrame()
{
  const char glyphs[] = "0123456789ABCDEFXYZ#*+<>$%&";
  const int numGlyphs = sizeof(glyphs) - 1;
  for (int i = 0; i < MATRIX_COLS; i++)
  {
    int colX = 20 + i * 12;
    int tailY = matrixY[i] - (matrixLen[i] * 12);
    if (tailY >= 44 && tailY <= 270)
      tft.fillRect(colX, tailY, 10, 14, 0x0000);

    if (matrixY[i] >= 44 && matrixY[i] <= 270)
    {
      tft.setTextFont(1);
      tft.setTextColor(T.accent3, 0x0000);
      if (matrixY[i] - 12 >= 44)
        tft.drawChar(glyphs[random(0, numGlyphs)], colX + 1, matrixY[i] - 12);
      tft.setTextColor(TFT_WHITE, 0x0000);
      tft.drawChar(glyphs[random(0, numGlyphs)], colX + 1, matrixY[i]);
    }
    matrixY[i] += matrixSpeed[i];
    if (matrixY[i] - (matrixLen[i] * 12) > 270)
    {
      matrixY[i] = 44 + random(0, 30);
      matrixSpeed[i] = random(4, 9);
      matrixLen[i] = random(6, 14);
    }
  }
}

void renderStarfieldFrame()
{
  for (int i = 0; i < NUM_STARS; i++)
  {
    int oldPx = 240 + (int)(stars[i].x / stars[i].z * 160.0f);
    int oldPy = 160 + (int)(stars[i].y / stars[i].z * 160.0f);
    if (oldPx >= 12 && oldPx <= 468 && oldPy >= 42 && oldPy <= 275)
    {
      tft.drawPixel(oldPx, oldPy, 0x0000);
      tft.drawPixel(oldPx + 1, oldPy, 0x0000);
    }
    stars[i].z -= 4.0f;
    if (stars[i].z <= 2.0f)
    {
      stars[i].x = random(-200, 200);
      stars[i].y = random(-150, 150);
      stars[i].z = 300;
    }

    int newPx = 240 + (int)(stars[i].x / stars[i].z * 160.0f);
    int newPy = 160 + (int)(stars[i].y / stars[i].z * 160.0f);
    if (newPx >= 12 && newPx <= 468 && newPy >= 42 && newPy <= 275)
    {
      uint16_t col = (stars[i].z < 100) ? TFT_WHITE : ((stars[i].z < 200) ? T.accent1 : T.textDark);
      tft.drawPixel(newPx, newPy, col);
      tft.drawPixel(newPx + 1, newPy, col);
    }
  }
}

void renderDvdFrame()
{
  int w = 70, h = 32, oldX = dvdX, oldY = dvdY;
  dvdX += dvdVX;
  dvdY += dvdVY;
  bool hit = false;
  if (dvdX <= 12 || dvdX + w >= 468)
  {
    dvdVX = -dvdVX;
    hit = true;
  }
  if (dvdY <= 42 || dvdY + h >= 275)
  {
    dvdVY = -dvdVY;
    hit = true;
  }
  if (hit)
  {
    uint16_t colors[] = {T.accent1, T.accent2, T.accent3, T.gold, T.tempCool, T.tempWarm};
    dvdColor = colors[random(0, 6)];
  }
  if (dvdX > oldX)
    tft.fillRect(oldX, oldY, dvdX - oldX, h, 0x0000);
  else if (dvdX < oldX)
    tft.fillRect(dvdX + w, oldY, oldX - dvdX, h, 0x0000);
  if (dvdY > oldY)
    tft.fillRect(oldX, oldY, w, dvdY - oldY, 0x0000);
  else if (dvdY < oldY)
    tft.fillRect(oldX, dvdY + h, w, oldY - dvdY, 0x0000);

  tft.fillRoundRect(dvdX, dvdY, w, h, 6, dvdColor);
  tft.setTextFont(2);
  tft.setTextColor(0x0000, dvdColor);
  tft.drawCentreString("CYD 3.5", dvdX + w / 2, dvdY + 8, 2);
}

void renderGifFrame()
{
  if (!gifIsOpen)
  {
    gif.begin(GIF_PALETTE_RGB565_BE);
    if (gif.open((uint8_t *)my_gif_data, my_gif_size, GIFDraw))
      gifIsOpen = true;
    else
      return;
  }
  if (gif.playFrame(true, NULL) == 0)
  {
    gif.close();
    if (gif.open((uint8_t *)my_gif_data, my_gif_size, GIFDraw))
      gifIsOpen = true;
    else
      gifIsOpen = false;
  }
}

void renderAnimationFrame()
{
  switch (currentAnim)
  {
  case 0:
    renderMatrixFrame();
    break;
  case 1:
    renderStarfieldFrame();
    break;
  case 2:
    renderDvdFrame();
    break;
  case 3:
    renderGifFrame();
    break;
  }
  animFrameCount++;
  unsigned long now = millis();
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

void drawSettingsPage() {
  tft.fillRoundRect(8, 36, 464, 279, 8, T.cardBg);

  tft.fillRect(16, 37, 448, 26, T.headerBg);
  tft.fillRect(16, 297, 448, 17, T.headerBg);

  tft.drawFastHLine(8, 63, 464, T.cardBorder);
  tft.drawFastHLine(8, 296, 464, T.cardBorder);

  tft.setTextFont(2); 
  tft.setTextColor(T.accent1, T.headerBg);
  tft.drawCentreString("THEME SETTINGS (15 THEMES)", 240, 42, 2);

  tft.setTextFont(1); 
  tft.setTextColor(T.textMuted, T.headerBg);
  tft.drawCentreString("SWIPE UP/DOWN TO SCROLL  |  TAP A THEME TO APPLY", 240, 301, 1);

  tft.drawRoundRect(8, 36, 464, 279, 8, T.cardBorder);

  drawSettingsContent();
}

void drawSettingsContent()
{
  tft.fillRect(9, 64, 454, 232, T.cardBg);

  for (int i = 0; i < TOTAL_THEMES; i++)
  {
    int col = i % 2, row = i / 2;
    int sx = 14 + col * 224, sy = 68 + row * 74 - settingsScrollY, sw = 216, sh = 66;

    if (sy + sh < 64 || sy > 295)
      continue;
    const ThemePalette *th = ALL_THEMES[i];
    bool isSelected = (i == selectedTheme);

    int drawY = max(64, sy);
    int drawH = min(295, sy + sh) - drawY;

    if (drawH > 0)
    {
      tft.fillRect(sx, drawY, sw, drawH, th->cardBg);
      uint16_t bColor = isSelected ? T.gold : th->cardBorder;
      if (sy >= 64 && sy + sh <= 295)
      {
        tft.drawRoundRect(sx, sy, sw, sh, 6, bColor);
        if (isSelected)
          tft.drawRoundRect(sx + 1, sy + 1, sw - 2, sh - 2, 5, T.gold);
      }
      else
      {
        if (sy >= 64)
          tft.drawFastHLine(sx, sy, sw, bColor);
        if (sy + sh <= 295)
          tft.drawFastHLine(sx, sy + sh - 1, sw, bColor);
        tft.drawFastVLine(sx, drawY, drawH, bColor);
        tft.drawFastVLine(sx + sw - 1, drawY, drawH, bColor);
      }
    }

    if (sy + 6 >= 64 && sy + 22 <= 295)
    {
      tft.setTextFont(2);
      tft.setTextColor(th->textWhite, th->cardBg);
      tft.drawString(th->name, sx + 8, sy + 6);
    }

    if (sy + 28 >= 64 && sy + 40 <= 295)
    {
      uint16_t pal[15] = {th->bg, th->cardBg, th->cardBorder, th->headerBg, th->barTrack, th->textWhite, th->textMuted, th->textDark, th->tempCool, th->tempWarm, th->tempHot, th->accent1, th->accent2, th->accent3, th->gold};
      for (int c = 0; c < 15; c++)
      {
        tft.fillRect(sx + 8 + c * 13, sy + 28, 12, 12, pal[c]);
        tft.drawRect(sx + 8 + c * 13, sy + 28, 12, 12, th->cardBorder);
      }
    }

    if (sy + 44 >= 64 && sy + 58 <= 295)
    {
      tft.fillRect(sx + 8, sy + 44, sw - 16, 14, th->headerBg);
      tft.drawRect(sx + 8, sy + 44, sw - 16, 14, th->cardBorder);
      tft.setTextFont(1);
      tft.setTextColor(th->textMuted, th->headerBg);
      tft.drawString("BG CARD TXT STATUS ACC", sx + 12, sy + 47);
    }

    if (isSelected && (sy + 7 >= 64 && sy + 29 <= 295))
    {
      int cx = sx + sw - 18, cy = sy + 18;
      tft.fillCircle(cx, cy, 11, T.gold);
      tft.drawCircle(cx, cy, 11, th->textWhite);
      tft.setTextFont(1);
      tft.setTextColor(th->bg, T.gold);
      tft.drawCentreString("OK", cx, cy - 8, 2);
    }
  }

  tft.fillRect(464, 64, 6, 232, T.headerBg);
  int barH = max(24, 232 * 232 / (5 * 74));
  int barY = 64 + (settingsScrollY * (232 - barH)) / MAX_SETTINGS_SCROLL;
  tft.fillRoundRect(464, barY, 6, barH, 2, T.gold);
}

void switchPage(int newPage)
{
  if (newPage < 0 || newPage >= TOTAL_PAGES)
    return;
  currentPage = newPage;
  if (gifIsOpen)
  {
    gif.close();
    gifIsOpen = false;
  }

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
//  WIFI MANAGER CAPTIVE PORTAL SETUP
// =========================================================================
void setupWiFiManager()
{
  WiFiManager wm;

  String savedUrl = prefs.getString("server_url", "http://192.168.1.50:8085/data.json");
  savedUrl.toCharArray(serverUrl, sizeof(serverUrl));

  WiFiManagerParameter customUrlParam("server_url", "LibreHardware JSON URL", serverUrl, 128);
  wm.addParameter(&customUrlParam);
  wm.setConfigPortalTimeout(180);

  tft.fillScreen(T.bg);
  tft.drawRoundRect(20, 20, 440, 280, 12, T.cardBorder);

  tft.setTextDatum(MC_DATUM);
  tft.setTextFont(4);
  tft.setTextColor(T.accent1, T.bg);
  tft.drawString("WIFI CAPTIVE PORTAL", 240, 50);

  tft.setTextFont(2);
  tft.setTextColor(T.textWhite, T.bg);
  tft.drawString("Connecting / Setup WiFi...", 240, 90);
  tft.drawString("Connect to Access Point via Phone:", 240, 130);

  tft.fillRoundRect(60, 155, 360, 36, 6, T.headerBg);
  tft.drawRoundRect(60, 155, 360, 36, 6, T.gold);
  tft.setTextFont(4);
  tft.setTextColor(T.gold, T.headerBg);
  tft.drawString("SSID: CYD-MONITOR-AP", 240, 173);

  tft.setTextFont(2);
  tft.setTextColor(T.textMuted, T.bg);
  tft.drawString("Pass: password123", 240, 215);
  tft.drawString("Configure WiFi & LibreHardware URL via browser", 240, 245);
  tft.setTextDatum(TL_DATUM);

  if (!wm.autoConnect("CYD-MONITOR-AP", "password123"))
  {
    Serial.println("Gagal connect / Portal timeout, restart...");
    delay(2000);
    ESP.restart();
  }

  String newUrl = customUrlParam.getValue();
  if (newUrl.length() > 0)
  {
    prefs.putString("server_url", newUrl);
    newUrl.toCharArray(serverUrl, sizeof(serverUrl));
  }

  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
}

// =========================================================================
//  SETUP & MAIN LOOP
// =========================================================================
void setup()
{
  Serial.begin(115200);
  pinMode(BOOT_BTN_PIN, INPUT_PULLUP);

  prefs.begin("hwmon", false);
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

  for (int i = 0; i < HISTORY_LEN; i++)
  {
    cpuHistory[i] = 0.0;
    gpuHistory[i] = 0.0;
  }

  setupWiFiManager();

  xTaskCreatePinnedToCore(httpFetchTask, "httpFetchTask", 8192, NULL, 1, &httpTaskHandle, 0);

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
      dragStartY = currentY;
      startScrollY = settingsScrollY;
      isDraggingSettings = false;

      if (pomodoroFinished)
        pomodoroFinished = false;
    }
    else
    {
      if (currentPage == 3 && abs((int)currentY - dragStartY) > 6)
      {
        isDraggingSettings = true;
        int deltaY = (int)currentY - dragStartY;
        int newScroll = constrain(startScrollY - deltaY, 0, MAX_SETTINGS_SCROLL);
        if (newScroll != settingsScrollY)
        {
          settingsScrollY = newScroll;
          drawSettingsContent();
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
        if (touchX >= 0 && touchX < 95)
          switchPage(0);
        else if (touchX >= 95 && touchX < 190)
          switchPage(1);
        else if (touchX >= 190 && touchX < 285)
          switchPage(2);
        else if (touchX >= 285 && touchX < 380)
          switchPage(3);
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
        else if (monitorSubPage == 1 && touchY >= 78 && touchY <= 178 && touchX >= 244 && touchX <= 464)
        {
          // Tap Card Latency/Ping untuk berganti target
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
      // Settings Theme Selection
      else if (currentPage == 3 && !isDraggingSettings && touchY >= 64 && touchY <= 296)
      {
        int row = (touchY - 68 + settingsScrollY) / 74;
        int col = (touchX >= 238) ? 1 : 0;
        int tappedTheme = row * 2 + col;
        if (tappedTheme >= 0 && tappedTheme < TOTAL_THEMES && tappedTheme != selectedTheme)
        {
          applyTheme(tappedTheme);
          tft.fillScreen(T.bg);
          drawHeaderTabs();
          drawSettingsPage();
        }
      }
    }
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
    renderAnimationFrame();
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