// Content script for Tab Switcher Previews

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

// Safety timeout to auto-close switcher if stuck
let safetyTimeout = null;
const SAFETY_TIMEOUT_MS = 10000; // 10 seconds max

// Settings
const SETTINGS_KEY = 'tabSwitcherSettings';
const LEGACY_SETTINGS_KEY = 'arcTabSwitcherSettings';
let currentSettings = {
  theme: 'dark',
  accentColor: 'blue',
  previewSize: 100,
  maxTabs: 'auto',
  showPreviews: true,
  peekModifier: 'Alt',
  peekSize: 75,
  peekBlur: 4
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
    const result = await chrome.storage.local.get([SETTINGS_KEY, LEGACY_SETTINGS_KEY]);
    const settings = result[SETTINGS_KEY] || result[LEGACY_SETTINGS_KEY];

    if (settings) {
      currentSettings = { ...currentSettings, ...settings };
    }

    if (!result[SETTINGS_KEY] && result[LEGACY_SETTINGS_KEY]) {
      await chrome.storage.local.set({ [SETTINGS_KEY]: result[LEGACY_SETTINGS_KEY] });
    }
  } catch (error) {
    // Silently fail, use defaults
  }
}

// Load settings on init
loadSettings();

function getPreviewDimensions() {
  const scale = Math.min(150, Math.max(75, parseInt(currentSettings.previewSize, 10) || 100)) / 100;

  return {
    cardWidth: Math.round(160 * scale),
    cardHeight: Math.round(140 * scale),
    previewHeight: Math.round(96 * scale)
  };
}

// Cleanup any existing instances (zombies)
function cleanupZombies() {
  const existingHost = document.getElementById('tab-switcher-host');
  if (existingHost) existingHost.remove();
  const existingOverlay = document.getElementById('tab-switcher-overlay');
  if (existingOverlay) existingOverlay.remove();
}
cleanupZombies();

// Reset keys on window blur and close switcher
window.addEventListener('blur', () => {
  ctrlPressed = false;
  metaPressed = false;
  shiftPressed = false;
  altPressed = false;

  // Close switcher when window loses focus (modifier key released outside window)
  if (switcherVisible) {
    const filteredTabs = getFilteredTabs();
    if (filteredTabs[selectedIndex]) {
      switchToTab(filteredTabs[selectedIndex].id);
    } else {
      hideSwitcher();
    }
  }
});

// Calculate how many tabs can fit in the current window width
function getMaxTabsForWidth() {
  // If user set a specific max, use that
  if (currentSettings.maxTabs !== 'auto') {
    return parseInt(currentSettings.maxTabs, 10);
  }

  const windowWidth = window.innerWidth;
  const { cardWidth } = getPreviewDimensions();
  const tabGap = 8;
  const containerPadding = 24;
  const minMargin = 100;

  const availableWidth = windowWidth - minMargin * 2 - containerPadding;
  const maxTabs = Math.floor((availableWidth + tabGap) / (cardWidth + tabGap));

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
  const { cardWidth, cardHeight, previewHeight } = getPreviewDimensions();

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
        --tab-card-width: ${cardWidth}px;
        --tab-card-height: ${cardHeight}px;
        --tab-preview-height: ${previewHeight}px;
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
        --tab-card-width: ${cardWidth}px;
        --tab-card-height: ${cardHeight}px;
        --tab-preview-height: ${previewHeight}px;
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

  // Set safety timeout to auto-close if stuck
  if (safetyTimeout) clearTimeout(safetyTimeout);
  safetyTimeout = setTimeout(() => {
    if (switcherVisible) {
      console.warn("Tab switcher safety timeout triggered - auto-closing");
      hideSwitcher();
    }
  }, SAFETY_TIMEOUT_MS);

  chrome.runtime.sendMessage({ action: "switcherShown" });

  const host = document.createElement('div');
  host.id = 'tab-switcher-host';
  host.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 2147483647; pointer-events: none;';
  document.body.appendChild(host);

  shadowRoot = host.attachShadow({ mode: 'open' });

  const themeStyle = document.createElement('style');
  themeStyle.textContent = getThemeStyles();
  shadowRoot.appendChild(themeStyle);

  const theme = getEffectiveTheme();
  const overlay = document.createElement('div');
  overlay.id = 'tab-switcher-overlay';
  overlay.className = `theme-${theme}`;
  overlay.style.visibility = 'hidden'; // Hide until styles are loaded
  overlay.innerHTML = `
    <div class="tab-switcher-container">
      <div class="tab-switcher-grid" id="tab-switcher-grid"></div>
    </div>
  `;

  shadowRoot.appendChild(overlay);

  // Load stylesheet and wait for it before showing
  const styleLink = document.createElement('link');
  styleLink.rel = 'stylesheet';
  styleLink.href = chrome.runtime.getURL('styles.css');

  await new Promise((resolve) => {
    styleLink.onload = resolve;
    styleLink.onerror = resolve; // Still show even if CSS fails
    shadowRoot.insertBefore(styleLink, themeStyle);
    // Fallback timeout in case onload doesn't fire
    setTimeout(resolve, 50);
  });

  renderTabs();
  overlay.style.visibility = 'visible'; // Now show the fully styled content

  // Click outside to close
  overlay.addEventListener('click', (e) => {
    // If click is on the overlay itself (not on a tab card), close the switcher
    if (e.target === overlay || e.target.classList.contains('tab-switcher-container')) {
      e.preventDefault();
      e.stopPropagation();
      hideSwitcher();
    }
  });
}

// Hide the switcher
function hideSwitcher() {
  if (!switcherVisible) return;

  // Clear safety timeout
  if (safetyTimeout) {
    clearTimeout(safetyTimeout);
    safetyTimeout = null;
  }

  const host = document.getElementById('tab-switcher-host');
  if (host) {
    host.remove();
  }
  shadowRoot = null;

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
  const grid = shadowRoot ? shadowRoot.getElementById('tab-switcher-grid') : null;
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
    grid.innerHTML = '<div class="tab-switcher-empty">No tabs found</div>';
    return;
  }

  filteredTabs.forEach((tab, index) => {
    const tabCard = document.createElement('div');
    tabCard.className = 'tab-switcher-card';
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

    const previewDiv = document.createElement('div');
    previewDiv.className = 'tab-switcher-preview';
    const previewImg = document.createElement('img');
    previewImg.setAttribute('src', previewSrc);
    previewImg.setAttribute('alt', '');
    previewDiv.appendChild(previewImg);

    const infoDiv = document.createElement('div');
    infoDiv.className = 'tab-switcher-info';
    const titleDiv = document.createElement('div');
    titleDiv.className = 'tab-switcher-title';
    const faviconImg = document.createElement('img');
    faviconImg.className = 'tab-switcher-favicon';
    faviconImg.setAttribute('src', faviconUrl);
    faviconImg.setAttribute('alt', '');
    const titleSpan = document.createElement('span');
    titleSpan.textContent = displayTitle;
    titleDiv.appendChild(faviconImg);
    titleDiv.appendChild(titleSpan);
    infoDiv.appendChild(titleDiv);

    tabCard.appendChild(previewDiv);
    tabCard.appendChild(infoDiv);

    tabCard.dataset.tabIndex = index;

    tabCard.addEventListener('mouseenter', () => {
      selectedIndex = index;
      renderTabs();
    });

    // Click to select and switch to tab
    tabCard.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      switchToTab(tab.id);
    });

    grid.appendChild(tabCard);
  });

  const selectedCard = grid.querySelector('.tab-switcher-card.selected');
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
  // Always hide the switcher first to prevent it getting stuck
  hideSwitcher();

  chrome.runtime.sendMessage({
    action: "switchToTab",
    tabId: tabId
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("Error switching tab:", chrome.runtime.lastError);
    }
  });
}

// Register key handlers once at script init (handles both global tracking and switcher logic)
document.addEventListener('keydown', handleGlobalKeydown, true);
document.addEventListener('keyup', handleGlobalKeyup, true);

// ========== PEEK FEATURE ==========

let peekVisible = false;
let peekHost = null;
let peekShadowRoot = null;

function isPeekModifierHeld(e) {
  switch (currentSettings.peekModifier) {
    case 'Alt': return e.altKey;
    case 'Control': return e.ctrlKey;
    case 'Meta': return e.metaKey;
    case 'Shift': return e.shiftKey;
    default: return e.altKey;
  }
}

// Find the closest anchor tag from an event target
function findClosestLink(el) {
  while (el && el !== document.body) {
    if (el.tagName === 'A' && el.href) return el;
    el = el.parentElement;
  }
  return null;
}

// Show visual hint on links when modifier is held
let peekHintActive = false;

function showPeekHints() {
  if (peekHintActive) return;
  peekHintActive = true;
  document.documentElement.classList.add('tab-switcher-peek-active');
}

function hidePeekHints() {
  if (!peekHintActive) return;
  peekHintActive = false;
  document.documentElement.classList.remove('tab-switcher-peek-active');
}

// Inject a minimal global style for the peek cursor hint (outside shadow DOM)
const peekGlobalStyle = document.createElement('style');
peekGlobalStyle.textContent = `
  .tab-switcher-peek-active a[href] {
    cursor: zoom-in !important;
  }
  .tab-switcher-peek-active a[href]:hover {
    outline: 2px dashed rgba(59, 130, 246, 0.5) !important;
    outline-offset: 2px !important;
    border-radius: 3px !important;
  }
`;
document.head.appendChild(peekGlobalStyle);

// Track modifier for peek hints
document.addEventListener('keydown', (e) => {
  if (peekVisible) return;
  if (e.key === currentSettings.peekModifier ||
      (currentSettings.peekModifier === 'Alt' && e.key === 'Alt') ||
      (currentSettings.peekModifier === 'Control' && e.key === 'Control') ||
      (currentSettings.peekModifier === 'Meta' && e.key === 'Meta') ||
      (currentSettings.peekModifier === 'Shift' && e.key === 'Shift')) {
    showPeekHints();
  }
}, true);

document.addEventListener('keyup', (e) => {
  if (e.key === 'Alt' || e.key === 'Control' || e.key === 'Meta' || e.key === 'Shift') {
    hidePeekHints();
  }
}, true);

window.addEventListener('blur', () => {
  hidePeekHints();
});

// Intercept clicks on links when modifier is held
document.addEventListener('click', (e) => {
  if (!isPeekModifierHeld(e)) return;

  const link = findClosestLink(e.target);
  if (!link) return;

  const url = link.href;
  // Skip javascript: links, anchors, and empty hrefs
  if (!url || url.startsWith('javascript:') || url.startsWith('#') || url === window.location.href + '#') return;

  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();

  hidePeekHints();
  openPeek(url, link.textContent.trim() || url);
}, true);

async function openPeek(url, title) {
  if (peekVisible) closePeek();

  peekVisible = true;

  peekHost = document.createElement('div');
  peekHost.id = 'tab-switcher-peek-host';
  peekHost.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 2147483647;';
  document.body.appendChild(peekHost);

  peekShadowRoot = peekHost.attachShadow({ mode: 'open' });

  const theme = getEffectiveTheme();
  const accent = accentColors[currentSettings.accentColor] || accentColors.blue;

  const displayTitle = title.length > 60 ? title.substring(0, 57) + '...' : title;
  let displayUrl = url;
  try {
    const parsed = new URL(url);
    displayUrl = parsed.hostname + parsed.pathname;
    if (displayUrl.length > 60) displayUrl = displayUrl.substring(0, 57) + '...';
  } catch (e) {}

  const isDark = theme === 'dark';

  // Peek size from slider (40–96%)
  const sizePercent = currentSettings.peekSize || 75;
  const sizeVW = sizePercent + 'vw';
  const sizeVH = sizePercent + 'vh';

  // Blur from slider (0–20px)
  const blurPx = currentSettings.peekBlur || 0;
  const bgOpacity = isDark ? 0.3 + (blurPx / 40) : 0.15 + (blurPx / 50);

  const style = document.createElement('style');
  style.textContent = `
    * { box-sizing: border-box; margin: 0; padding: 0; }

    .peek-backdrop {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, ${bgOpacity.toFixed(2)});
      backdrop-filter: blur(${blurPx}px);
      -webkit-backdrop-filter: blur(${blurPx}px);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      animation: peekFadeIn 0.15s ease-out;
    }

    @keyframes peekFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes peekSlideUp {
      from { opacity: 0; transform: translateY(20px) scale(0.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    .peek-panel {
      width: ${sizeVW};
      max-width: ${sizePercent >= 96 ? '100%' : '1600px'};
      height: ${sizeVH};
      max-height: ${sizePercent >= 96 ? '100%' : '1000px'};
      background: ${isDark ? '#1e1e23' : '#ffffff'};
      border-radius: 14px;
      box-shadow: ${isDark
        ? '0 25px 60px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.08)'
        : '0 25px 60px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(0, 0, 0, 0.06)'};
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: peekSlideUp 0.2s ease-out;
    }

    .peek-titlebar {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      background: ${isDark ? '#16161a' : '#f5f5f7'};
      border-bottom: 1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'};
      flex-shrink: 0;
      user-select: none;
      -webkit-user-select: none;
    }

    .peek-titlebar-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .peek-title {
      font-size: 13px;
      font-weight: 600;
      color: ${isDark ? '#e4e4e7' : '#18181b'};
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .peek-url {
      font-size: 11px;
      color: ${isDark ? '#71717a' : '#a1a1aa'};
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .peek-btn {
      background: ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'};
      border: 1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'};
      color: ${isDark ? '#a1a1aa' : '#52525b'};
      border-radius: 8px;
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 5px;
      white-space: nowrap;
      font-family: inherit;
      transition: background 0.1s, color 0.1s;
    }

    .peek-btn:hover {
      background: ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'};
      color: ${isDark ? '#e4e4e7' : '#18181b'};
    }

    .peek-btn-open {
      background: ${accent.primary};
      border-color: ${accent.primary};
      color: #ffffff;
    }

    .peek-btn-open:hover {
      background: ${accent.primary};
      filter: brightness(1.15);
      color: #ffffff;
    }

    .peek-btn-close {
      width: 30px;
      height: 30px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      font-size: 16px;
      line-height: 1;
    }

    .peek-content {
      flex: 1;
      position: relative;
      overflow: hidden;
    }

    .peek-iframe {
      width: 100%;
      height: 100%;
      border: none;
      background: ${isDark ? '#1e1e23' : '#ffffff'};
    }

    .peek-loading {
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 3px;
      background: ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'};
      overflow: hidden;
    }

    .peek-loading-bar {
      height: 100%;
      width: 30%;
      background: ${accent.primary};
      border-radius: 3px;
      animation: peekLoading 1.2s ease-in-out infinite;
    }

    @keyframes peekLoading {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(400%); }
    }

    .peek-loading.loaded {
      opacity: 0;
      transition: opacity 0.3s;
    }

    .peek-error {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      gap: 12px;
      color: ${isDark ? '#71717a' : '#a1a1aa'};
      font-size: 14px;
      padding: 40px;
      text-align: center;
    }

    .peek-error-icon {
      font-size: 32px;
      opacity: 0.5;
    }
  `;

  peekShadowRoot.appendChild(style);

  const backdrop = document.createElement('div');
  backdrop.className = 'peek-backdrop';
  backdrop.innerHTML = `
    <div class="peek-panel">
      <div class="peek-titlebar">
        <div class="peek-titlebar-info">
          <div class="peek-title">${escapeHTML(displayTitle)}</div>
          <div class="peek-url">${escapeHTML(displayUrl)}</div>
        </div>
        <button class="peek-btn peek-btn-open" id="peek-open-tab">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M5 1H2.5A1.5 1.5 0 001 2.5v7A1.5 1.5 0 002.5 11h7A1.5 1.5 0 0011 9.5V7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M7 1h4v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M11 1L5.5 6.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          Open in Tab
        </button>
        <button class="peek-btn peek-btn-close" id="peek-close">\u00d7</button>
      </div>
      <div class="peek-content">
        <div class="peek-loading" id="peek-loading">
          <div class="peek-loading-bar"></div>
        </div>
        <iframe class="peek-iframe" id="peek-iframe" loading="eager"></iframe>
      </div>
    </div>
  `;

  peekShadowRoot.appendChild(backdrop);

  const iframe = peekShadowRoot.getElementById('peek-iframe');
  const loading = peekShadowRoot.getElementById('peek-loading');

  // Track the current URL as user navigates within the iframe
  let currentPeekUrl = url;

  iframe.addEventListener('load', () => {
    loading.classList.add('loaded');

    // Try to read the iframe's current URL (works for same-origin navigations)
    try {
      const iframeUrl = iframe.contentWindow.location.href;
      if (iframeUrl && iframeUrl !== 'about:blank') {
        currentPeekUrl = iframeUrl;

        // Update the title bar to reflect the new page
        const titleEl = peekShadowRoot.querySelector('.peek-title');
        const urlEl = peekShadowRoot.querySelector('.peek-url');
        if (titleEl) {
          try {
            const newTitle = iframe.contentDocument.title || iframeUrl;
            titleEl.textContent = newTitle.length > 60 ? newTitle.substring(0, 57) + '...' : newTitle;
          } catch (e) {}
        }
        if (urlEl) {
          try {
            const parsed = new URL(iframeUrl);
            let short = parsed.hostname + parsed.pathname;
            if (short.length > 60) short = short.substring(0, 57) + '...';
            urlEl.textContent = short;
          } catch (e) {}
        }
      }
    } catch (e) {
      // Cross-origin — can't read URL, keep the last known one
    }
  });

  // Some sites block iframes via X-Frame-Options / CSP — handle gracefully
  iframe.addEventListener('error', () => {
    showPeekError(url);
  });

  // Set src after attaching to DOM
  iframe.src = url;

  // After a timeout, if iframe is still "loading", check if it might be blocked
  setTimeout(() => {
    if (peekVisible && !loading.classList.contains('loaded')) {
      // Can't reliably detect X-Frame-Options from content script,
      // but the loading bar will just keep going — that's acceptable
    }
  }, 5000);

  // Close on backdrop click
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      closePeek();
    }
  });

  // Close button
  peekShadowRoot.getElementById('peek-close').addEventListener('click', () => {
    closePeek();
  });

  // Open in tab button — uses the iframe's current URL, not the original
  peekShadowRoot.getElementById('peek-open-tab').addEventListener('click', () => {
    // Try to get the latest URL from the iframe in case load event was missed
    try {
      const liveUrl = iframe.contentWindow.location.href;
      if (liveUrl && liveUrl !== 'about:blank') {
        currentPeekUrl = liveUrl;
      }
    } catch (e) {}

    chrome.runtime.sendMessage({ action: "openInNewTab", url: currentPeekUrl });
    closePeek();
  });

  // Close on Escape
  document.addEventListener('keydown', handlePeekKeydown, true);
}

function showPeekError(url) {
  if (!peekShadowRoot) return;
  const content = peekShadowRoot.querySelector('.peek-content');
  if (!content) return;

  const isDark = getEffectiveTheme() === 'dark';
  content.innerHTML = `
    <div class="peek-error">
      <div class="peek-error-icon">\u26a0\ufe0f</div>
      <div>This site can't be previewed — it blocks embedding.</div>
      <button class="peek-btn peek-btn-open" id="peek-error-open" style="margin-top: 8px;">Open in New Tab</button>
    </div>
  `;

  const openBtn = peekShadowRoot.getElementById('peek-error-open');
  if (openBtn) {
    openBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: "openInNewTab", url: url });
      closePeek();
    });
  }
}

function handlePeekKeydown(e) {
  if (!peekVisible) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closePeek();
  }
}

function closePeek() {
  if (!peekVisible) return;
  peekVisible = false;

  if (peekHost) {
    peekHost.remove();
    peekHost = null;
  }
  peekShadowRoot = null;

  document.removeEventListener('keydown', handlePeekKeydown, true);
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
