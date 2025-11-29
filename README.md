# Chrome Tab Switcher Previews

A fast, minimal tab switcher for Chrome with real page previews. Cycle through your most recently used tabs instantly.

## Features

- **MRU Tab Switching** - Switch between your 5 most recently used tabs
- **Real Page Previews** - Shows actual screenshots of your tabs
- **Instant UI** - No animations or delays
- **Keyboard Only** - Simple keyboard navigation
- **Customizable Shortcuts** - Set your preferred key combinations
- **Settings Page** - Configure hotkeys and appearance

## Installation

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked**
5. Select the extension folder

## Setup Keyboard Shortcuts

1. Go to `chrome://extensions/shortcuts`
2. Find "Chrome Tab Switcher Previews"
3. Set your preferred shortcuts for forward/backward navigation

## Usage

- Press your shortcut to open the switcher
- Keep pressing to cycle through tabs
- Release the modifier key (Ctrl/Cmd) to switch to the selected tab
- Press Esc to cancel

## Files

- `manifest.json` - Extension configuration
- `background.js` - Background service worker
- `content.js` - Tab switcher UI logic
- `styles.css` - Styling
- `options.html` - Settings page

## License

MIT
