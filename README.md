<p align="center">
  <img src="icons/icon-128.png" alt="Claude Monitor" width="96">
</p>

<h1 align="center">Claude Monitor</h1>

<p align="center">
  <strong>Chrome extension to monitor your Claude AI usage in real time</strong><br>
  Never hit your limits unexpectedly again.
</p>

<p align="center">
  <a href="#features">Features</a> &bull;
  <a href="#installation">Installation</a> &bull;
  <a href="#how-it-works">How It Works</a> &bull;
  <a href="#configuration">Configuration</a> &bull;
  <a href="#contributing">Contributing</a>
</p>

---

## Why?

If you use Claude daily (especially Claude Code), you know the frustration of hitting rate limits mid-task. The only way to check usage is manually refreshing `claude.ai/settings/usage` throughout the day.

**Claude Monitor** puts your usage right on the Chrome toolbar. Glance at the badge, get notified before limits hit, and track your usage patterns over time.

## Features

**Real-time monitoring**
- Color-coded badge on the toolbar showing current session usage
- Popup with session and weekly usage bars + reset countdown timers

**Smart alerts**
- Windows toast notifications at configurable thresholds (default: 50%, 70%, 90%)
- Alerts fire once per threshold per reset cycle - no spam

**Usage history**
- Automatic logging at the end of each 5-hour session window
- Interactive chart showing usage per session grouped by day
- Paginated table with day grouping
- Stats: average session usage, total sessions, average weekly usage

**Fully configurable**
- Custom color intervals (define your own color for each usage range)
- Custom alert thresholds
- Adjustable polling interval (1-30 minutes)
- Optional Sonnet usage display

**Zero configuration needed**
- Auto-discovers your organization from your logged-in Claude session
- No API keys required - works with your existing browser session
- Login prompt if not authenticated

## Screenshots

| Popup | History | Settings |
|-------|---------|----------|
| ![Popup](docs/screenshot-popup.png) | ![History](docs/screenshot-history.png) | ![Settings](docs/screenshot-settings.png) |

## Installation

### From Chrome Web Store
*(Coming soon)*

### Manual (Developer Mode)
1. Clone this repository:
   ```bash
   git clone https://github.com/sampaiodaniel/claude-monitor.git
   ```
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked** and select the `claude-monitor` folder
5. Log in to [claude.ai](https://claude.ai) if you haven't already
6. The badge will start showing your current usage

## How It Works

Claude Monitor polls the internal usage API at `claude.ai/api/organizations/{org}/usage` using your existing browser session cookies. This is the same endpoint that the usage settings page uses.

**What it reads:**
- `five_hour.utilization` - Current session usage (%)
- `five_hour.resets_at` - When the session resets
- `seven_day.utilization` - Weekly usage across all models (%)
- `seven_day.resets_at` - When the weekly limit resets

**No API key needed.** The extension runs in the context of your browser where you're already logged in to Claude. It uses `fetch` with credentials from the Chrome extension service worker, which automatically includes your session cookies.

**Privacy:** All data stays local in `chrome.storage`. Nothing is sent to external servers. No analytics. No tracking.

## Configuration

Open settings via the gear icon in the popup or right-click the extension icon and select "Options".

### Color intervals
Define color ranges for the usage bars and badge:
| Range | Default Color |
|-------|--------------|
| 0-49% | Green |
| 50-69% | Yellow |
| 70-89% | Orange |
| 90-100% | Red |

Colors are fully customizable with 8 palette options. You can add, remove, or modify intervals.

### Alerts
Set percentage thresholds where you want to receive Windows notifications. Default: 50%, 70%, 90%.

### Polling interval
How often the extension checks your usage. Default: 5 minutes. Range: 1-30 minutes.

## Tech Stack

- Chrome Extension Manifest V3
- Vanilla JavaScript (no frameworks, no dependencies)
- HTML/CSS with dark theme
- Canvas API for charts
- `chrome.storage` for settings and history
- `chrome.alarms` for periodic polling
- `chrome.notifications` for Windows toast alerts

## Requirements

- Google Chrome (or Chromium-based browser)
- Active Claude account (Pro, Team, or Enterprise)
- Logged in to [claude.ai](https://claude.ai)

## Contributing

Contributions are welcome! Feel free to open issues or submit PRs.

## License

MIT
