// Content script for Arc Tab Switcher

let switcherVisible = false;
let shadowRoot = null;
let currentTabs = [];
let currentTabId = null;
let selectedIndex = 0;
let searchQuery = "";

// Track modifier key states
let ctrlPressed = false;
let metaPressed = false;
let shiftPressed = false;
let altPressed = false;

// Settings
const SETTINGS_KEY = 'arcTabSwitcherSettings';
let currentSettings = {
  theme: 'dark',
  accentColor: 'blue',
  maxTabs: 'auto',
  showPreviews: true
};

// Accent color map
const accentColors = {
  blue: { primary: '#3b82f6', hover: 'rgba(59, 130, 246, 0.3)' },
  purple: { primary: '#8b5cf6', hover: 'rgba(139, 92, 246, 0.3)' },
  pink: { primary: '#ec4899', hover: 'rgba(236, 72, 153, 0.3)' },
  red: { primary: '#ef4444', hover: 'rgba(239, 68, 68, 0.3)' },
  orange: { primary: '#f97316', hover: 'rgba(249, 115, 22, 0.3)' },
  green: { primary: '#22c55e', hover: 'rgba(34, 197, 94, 0.3)' },
  teal: { primary: '#14b8a6', hover: 'rgba(20, 184, 166, 0.3)' }
};

// Load settings from storage
async function loadSettings() {
  try {
    const result = await chrome.storage.local.get(SETTINGS_KEY);
    if (result[SETTINGS_KEY]) {
      currentSettings = { ...currentSettings, ...result[SETTINGS_KEY] };
    }
  } catch (error) {
    // Silently fail, use defaults
  }
}

// Load settings on init
loadSettings();

// Cleanup any existing instances (zombies)
function cleanupZombies() {
  const existingHost = document.getElementById('arc-tab-switcher-host');
  if (existingHost) existingHost.remove();
  const existingOverlay = document.getElementById('arc-tab-switcher-overlay');
  if (existingOverlay) existingOverlay.remove();
}
cleanupZombies();

// Reset keys on window blur
window.addEventListener('blur', () => {
  ctrlPressed = false;
  metaPressed = false;
  shiftPressed = false;
  altPressed = false;
});

// Calculate how many tabs can fit in the current window width
function getMaxTabsForWidth() {
  // If user set a specific max, use that
  if (currentSettings.maxTabs !== 'auto') {
    return parseInt(currentSettings.maxTabs, 10);
  }

  const windowWidth = window.innerWidth;
  const tabWidth = 160;
  const tabGap = 8;
  const containerPadding = 24;
  const minMargin = 100;

  const availableWidth = windowWidth - minMargin * 2 - containerPadding;
  const maxTabs = Math.floor((availableWidth + tabGap) / (tabWidth + tabGap));

  return Math.max(1, maxTabs);
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      if (request.action === "ping") {
        sendResponse({ success: true });
      } else if (request.action === "toggleSwitcher") {
        currentTabs = request.tabs || [];
        currentTabId = request.currentTabId;
        const direction = request.direction || "forward";

        const maxTabs = getMaxTabsForWidth();
        currentTabs = currentTabs.slice(0, maxTabs);

        if (switcherVisible) {
          const filteredTabs = getFilteredTabs();
          if (filteredTabs.length > 0) {
            if (direction === "forward") {
              selectedIndex = (selectedIndex + 1) % filteredTabs.length;
            } else {
              selectedIndex = (selectedIndex - 1 + filteredTabs.length) % filteredTabs.length;
            }
            renderTabs();
          }
        } else {
          if (direction === "forward") {
            selectedIndex = currentTabs.length > 1 ? 1 : 0;
          } else {
            selectedIndex = currentTabs.length > 1 ? currentTabs.length - 1 : 0;
          }
          await showSwitcher();
        }
        sendResponse({ success: true });
      }
    } catch (error) {
      console.error("Error in message listener:", error);
      sendResponse({ success: false, error: error.message });
    }
  })();
  return true;
});

// Get the effective theme (resolve 'system' to actual theme)
function getEffectiveTheme() {
  if (currentSettings.theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return currentSettings.theme;
}

// Generate theme-specific CSS variables
function getThemeStyles() {
  const theme = getEffectiveTheme();
  const accent = accentColors[currentSettings.accentColor] || accentColors.blue;

  if (theme === 'light') {
    return `
      :host {
        --bg-primary: rgba(255, 255, 255, 0.98);
        --bg-secondary: rgba(0, 0, 0, 0.04);
        --bg-hover: rgba(0, 0, 0, 0.08);
        --bg-selected: rgba(0, 0, 0, 0.06);
        --text-primary: #18181b;
        --text-secondary: #71717a;
        --border-color: rgba(0, 0, 0, 0.1);
        --shadow: 0 8px 32px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.05);
        --accent-color: ${accent.primary};
        --accent-hover: ${accent.hover};
      }
    `;
  } else {
    return `
      :host {
        --bg-primary: rgba(30, 30, 35, 0.98);
        --bg-secondary: rgba(255, 255, 255, 0.04);
        --bg-hover: rgba(255, 255, 255, 0.08);
        --bg-selected: rgba(255, 255, 255, 0.06);
        --text-primary: #ffffff;
        --text-secondary: #a1a1aa;
        --border-color: rgba(255, 255, 255, 0.1);
        --shadow: 0 8px 32px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.1);
        --accent-color: ${accent.primary};
        --accent-hover: ${accent.hover};
      }
    `;
  }
}

// Create and show the switcher overlay
async function showSwitcher() {
  if (switcherVisible) return;
  cleanupZombies();

  await loadSettings();

  switcherVisible = true;
  searchQuery = "";

  chrome.runtime.sendMessage({ action: "switcherShown" });

  const host = document.createElement('div');
  host.id = 'arc-tab-switcher-host';
  host.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 2147483647; pointer-events: none;';
  document.body.appendChild(host);

  shadowRoot = host.attachShadow({ mode: 'open' });

  const styleLink = document.createElement('link');
  styleLink.rel = 'stylesheet';
  styleLink.href = chrome.runtime.getURL('styles.css');
  shadowRoot.appendChild(styleLink);

  const themeStyle = document.createElement('style');
  themeStyle.textContent = getThemeStyles();
  shadowRoot.appendChild(themeStyle);

  const theme = getEffectiveTheme();
  const overlay = document.createElement('div');
  overlay.id = 'arc-tab-switcher-overlay';
  overlay.className = `theme-${theme}`;
  overlay.innerHTML = `
    <div class="arc-switcher-container">
      <div class="arc-tabs-grid" id="arc-tabs-grid"></div>
    </div>
  `;

  shadowRoot.appendChild(overlay);
  renderTabs();
  setupEventListeners();
}

// Hide the switcher
function hideSwitcher() {
  if (!switcherVisible) return;

  const host = document.getElementById('arc-tab-switcher-host');
  if (host) {
    host.remove();
  }
  shadowRoot = null;

  document.removeEventListener('keydown', handleGlobalKeydown, true);
  document.removeEventListener('keyup', handleGlobalKeyup, true);

  switcherVisible = false;
  searchQuery = "";

  ctrlPressed = false;
  metaPressed = false;
  shiftPressed = false;
  altPressed = false;

  chrome.runtime.sendMessage({ action: "switcherHidden" });
}

// Render tabs in the grid
function renderTabs() {
  const grid = shadowRoot ? shadowRoot.getElementById('arc-tabs-grid') : null;
  if (!grid) return;

  const filteredTabs = getFilteredTabs();

  if (selectedIndex >= filteredTabs.length) {
    selectedIndex = filteredTabs.length - 1;
  }
  if (selectedIndex < 0) {
    selectedIndex = 0;
  }

  grid.innerHTML = '';

  if (filteredTabs.length === 0) {
    grid.innerHTML = '<div class="arc-no-results">No tabs found</div>';
    return;
  }

  filteredTabs.forEach((tab, index) => {
    const tabCard = document.createElement('div');
    tabCard.className = 'arc-tab-card';
    if (index === selectedIndex) {
      tabCard.classList.add('selected');
    }
    if (tab.id === currentTabId) {
      tabCard.classList.add('current');
    }

    const title = tab.title || 'Untitled';
    const displayTitle = title.length > 30 ? title.substring(0, 27) + '...' : title;

    let previewSrc;
    if (tab.screenshot && currentSettings.showPreviews) {
      previewSrc = tab.screenshot;
    } else {
      let domain = '';
      try {
        const url = new URL(tab.url || '');
        domain = url.hostname.replace(/^www\./, '');
        if (domain.length > 25) {
          domain = domain.substring(0, 22) + '...';
        }
      } catch (e) {
        domain = 'New Tab';
      }

      const escapedDomain = domain.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      previewSrc = `data:image/svg+xml,${encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="200" height="125" viewBox="0 0 200 125">
          <defs>
            <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style="stop-color:#f8fafc"/>
              <stop offset="100%" style="stop-color:#e2e8f0"/>
            </linearGradient>
          </defs>
          <rect width="200" height="125" fill="url(#bg)"/>
          <rect x="0" y="0" width="200" height="28" fill="#f1f5f9"/>
          <circle cx="12" cy="14" r="5" fill="#ef4444" opacity="0.8"/>
          <circle cx="28" cy="14" r="5" fill="#eab308" opacity="0.8"/>
          <circle cx="44" cy="14" r="5" fill="#22c55e" opacity="0.8"/>
          <text x="100" y="72" font-family="system-ui, -apple-system, sans-serif" font-size="13" fill="#475569" text-anchor="middle" font-weight="500">${escapedDomain}</text>
          <text x="100" y="92" font-family="system-ui, -apple-system, sans-serif" font-size="10" fill="#94a3b8" text-anchor="middle">No preview available</text>
        </svg>
      `)}`;
    }

    const faviconUrl = tab.favIconUrl || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="%23888"/></svg>';

    tabCard.innerHTML = `
      <div class="arc-tab-preview">
        <img src="${previewSrc}" alt="">
      </div>
      <div class="arc-tab-info">
        <div class="arc-tab-title">
          <img class="arc-tab-favicon" src="${faviconUrl}" alt="">
          <span>${escapeHtml(displayTitle)}</span>
        </div>
      </div>
    `;

    tabCard.dataset.tabIndex = index;

    tabCard.addEventListener('mouseenter', () => {
      selectedIndex = index;
      renderTabs();
    });

    grid.appendChild(tabCard);
  });

  const selectedCard = grid.querySelector('.arc-tab-card.selected');
  if (selectedCard) {
    selectedCard.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }
}

// Get filtered tabs based on search query
function getFilteredTabs() {
  if (!searchQuery) {
    return currentTabs;
  }

  const query = searchQuery.toLowerCase();
  return currentTabs.filter(tab => {
    const title = (tab.title || '').toLowerCase();
    const url = (tab.url || '').toLowerCase();
    return title.includes(query) || url.includes(query);
  });
}

// Setup event listeners
function setupEventListeners() {
  document.addEventListener('keydown', handleGlobalKeydown, true);
  document.addEventListener('keyup', handleGlobalKeyup, true);
}

// Handle global keydown when switcher is open
function handleGlobalKeydown(e) {
  if (e.key === 'Control') ctrlPressed = true;
  if (e.key === 'Meta') metaPressed = true;
  if (e.key === 'Shift') shiftPressed = true;
  if (e.key === 'Alt') altPressed = true;

  if (!switcherVisible) return;

  // Handle Escape to close switcher
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    hideSwitcher();
    return;
  }

  // Handle arrow keys for navigation
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault();
    e.stopPropagation();
    const filteredTabs = getFilteredTabs();
    if (filteredTabs.length > 0) {
      selectedIndex = (selectedIndex + 1) % filteredTabs.length;
      renderTabs();
    }
    return;
  }

  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault();
    e.stopPropagation();
    const filteredTabs = getFilteredTabs();
    if (filteredTabs.length > 0) {
      selectedIndex = (selectedIndex - 1 + filteredTabs.length) % filteredTabs.length;
      renderTabs();
    }
    return;
  }
}

// Handle global keyup when switcher is open
function handleGlobalKeyup(e) {
  if (e.key === 'Control') ctrlPressed = false;
  if (e.key === 'Meta') metaPressed = false;
  if (e.key === 'Shift') shiftPressed = false;
  if (e.key === 'Alt') altPressed = false;

  if (!switcherVisible) return;

  // When any modifier key is released, check if all modifier keys are released
  if (e.key === 'Control' || e.key === 'Meta' || e.key === 'Alt' || e.key === 'Shift') {
    e.preventDefault();

    // Only switch if no modifier keys are being held
    if (!ctrlPressed && !metaPressed && !altPressed && !shiftPressed) {
      const filteredTabs = getFilteredTabs();
      if (filteredTabs[selectedIndex]) {
        switchToTab(filteredTabs[selectedIndex].id);
      }
    }
  }
}

// Switch to a tab
function switchToTab(tabId) {
  chrome.runtime.sendMessage({
    action: "switchToTab",
    tabId: tabId
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("Error switching tab:", chrome.runtime.lastError);
    }
    hideSwitcher();
  });
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Global key tracking for all pages
document.addEventListener('keydown', (e) => {
  if (e.key === 'Control') ctrlPressed = true;
  if (e.key === 'Meta') metaPressed = true;
  if (e.key === 'Shift') shiftPressed = true;
  if (e.key === 'Alt') altPressed = true;
}, true);

document.addEventListener('keyup', (e) => {
  if (e.key === 'Control') ctrlPressed = false;
  if (e.key === 'Meta') metaPressed = false;
  if (e.key === 'Shift') shiftPressed = false;
  if (e.key === 'Alt') altPressed = false;
}, true);
