// Content script for Arc Tab Switcher

let switcherVisible = false;
let shadowRoot = null;
let currentTabs = [];
let currentTabId = null;
let selectedIndex = 0;
let searchQuery = "";
let autoSwitchTimer = null;

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
  showPreviews: true,
  hotkeys: {
    closeTab: 'w',
    nextTab: 'ArrowRight',
    prevTab: 'ArrowLeft'
  }
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
    console.warn('Failed to load settings:', error);
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
  // Also close switcher if open? Maybe not, user might be alt-tabbing.
  // But if they leave the window, the switcher is less relevant.
  // For now just reset keys to prevent stuck modifiers.
});

// Calculate how many tabs can fit in the current window width
function getMaxTabsForWidth() {
  // If user set a specific max, use that
  if (currentSettings.maxTabs !== 'auto') {
    return parseInt(currentSettings.maxTabs, 10);
  }

  const windowWidth = window.innerWidth;
  const tabWidth = 160; // Card width
  const tabGap = 8; // Gap between cards
  const containerPadding = 24; // 12px on each side
  const minMargin = 100; // 100px margin from window edges (user requested)

  // Available width for tabs
  const availableWidth = windowWidth - minMargin * 2 - containerPadding;

  // Calculate how many tabs fit: width = (tabWidth * n) + (tabGap * (n-1))
  // Solving: availableWidth = tabWidth * n + tabGap * n - tabGap
  // availableWidth = n * (tabWidth + tabGap) - tabGap
  const maxTabs = Math.floor((availableWidth + tabGap) / (tabWidth + tabGap));

  // Minimum 1 tab, no maximum limit (removed the 5 tab limit)
  return Math.max(1, maxTabs);
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Handle async operations properly
  (async () => {
    try {
      if (request.action === "ping") {
        sendResponse({ success: true });
      } else if (request.action === "toggleSwitcher") {
        currentTabs = request.tabs || [];
        currentTabId = request.currentTabId;
        const direction = request.direction || "forward";

        // Limit tabs based on available window width
        const maxTabs = getMaxTabsForWidth();
        const limitedTabs = currentTabs.slice(0, maxTabs);
        currentTabs = limitedTabs;

        if (switcherVisible) {
          // Already visible, cycle to next or previous tab based on direction
          const filteredTabs = getFilteredTabs();
          if (filteredTabs.length > 0) {
            if (direction === "forward") {
              selectedIndex = (selectedIndex + 1) % filteredTabs.length;
            } else {
              selectedIndex = (selectedIndex - 1 + filteredTabs.length) % filteredTabs.length;
            }
            renderTabs();
            // Reset auto-switch timer
            startAutoSwitchTimer();
          }
        } else {
          // Show UI immediately and start with second tab selected for forward, last for backward
          if (direction === "forward") {
            selectedIndex = currentTabs.length > 1 ? 1 : 0;
          } else {
            selectedIndex = currentTabs.length > 1 ? currentTabs.length - 1 : 0;
          }
          await showSwitcher();
          // Start timer to auto-switch if user stops pressing the key (simulates key release)
          startAutoSwitchTimer();
        }
        sendResponse({ success: true });
      }
    } catch (error) {
      console.error("Error in message listener:", error);
      sendResponse({ success: false, error: error.message });
    }
  })();
  return true; // Keep the message channel open for async response
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

  // Reload settings before showing
  await loadSettings();
  console.log('[ArcSwitcher] Settings loaded:', currentSettings);

  switcherVisible = true;
  searchQuery = "";
  console.log('[ArcSwitcher] Switcher now visible');

  // Notify background that switcher is now visible
  chrome.runtime.sendMessage({ action: "switcherShown" });

  // Create host for Shadow DOM
  const host = document.createElement('div');
  host.id = 'arc-tab-switcher-host';
  host.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 2147483647; pointer-events: none;';
  document.body.appendChild(host);

  shadowRoot = host.attachShadow({ mode: 'open' });

  // Inject base styles
  const styleLink = document.createElement('link');
  styleLink.rel = 'stylesheet';
  styleLink.href = chrome.runtime.getURL('styles.css');
  shadowRoot.appendChild(styleLink);

  // Inject theme-specific styles
  const themeStyle = document.createElement('style');
  themeStyle.textContent = getThemeStyles();
  shadowRoot.appendChild(themeStyle);

  // Create overlay container with theme class
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

  // Render tabs
  renderTabs();

  // Setup event listeners
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

  // Clean up global event listeners (must match the capturing flag used when adding)
  document.removeEventListener('keydown', handleGlobalKeydown, true);
  document.removeEventListener('keyup', handleGlobalKeyup, true);
  
  // Clear auto-switch timer
  if (autoSwitchTimer) {
    clearTimeout(autoSwitchTimer);
    autoSwitchTimer = null;
  }
  
  switcherVisible = false;
  searchQuery = "";
  
  // Reset modifier key states
  ctrlPressed = false;
  metaPressed = false;
  shiftPressed = false;
  altPressed = false;
  
  // Notify background that switcher is now hidden
  chrome.runtime.sendMessage({ action: "switcherHidden" });
}

// Start or restart the auto-switch timer
function startAutoSwitchTimer() {
  // Clear existing timer
  if (autoSwitchTimer) {
    clearTimeout(autoSwitchTimer);
  }
  
  // Removed the auto-switch timer - user should control when to switch via key release only
  autoSwitchTimer = null;
}

// Render tabs in the grid
function renderTabs() {
  const grid = shadowRoot ? shadowRoot.getElementById('arc-tabs-grid') : null;
  if (!grid) return;
  
  const filteredTabs = getFilteredTabs();
  
  // Adjust selected index if needed
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
    
    // Truncate title
    const title = tab.title || 'Untitled';
    const displayTitle = title.length > 30 ? title.substring(0, 27) + '...' : title;
    
    // Use real screenshot if available, otherwise create informative fallback preview
    let previewSrc;
    if (tab.screenshot) {
      previewSrc = tab.screenshot;
    } else {
      // Create a fallback preview showing the domain name
      let domain = '';
      try {
        const url = new URL(tab.url || '');
        domain = url.hostname.replace(/^www\./, '');
        // Truncate long domains
        if (domain.length > 25) {
          domain = domain.substring(0, 22) + '...';
        }
      } catch (e) {
        domain = 'New Tab';
      }

      // Escape the domain for use in SVG
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
    
    // Get favicon URL or use default
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
    
    // Add mouse hover support - hover to select, key release to switch
    tabCard.addEventListener('mouseenter', () => {
      console.log('Hovering over tab:', index);
      selectedIndex = index;
      renderTabs();
      // Selection is now updated, key release will switch to this tab
    });
    
    grid.appendChild(tabCard);
  });
  
  // Scroll selected card into view (instant, no animation)
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
  // Use capturing phase (true) to ensure we get events before other handlers
  document.addEventListener('keydown', handleGlobalKeydown, true);
  document.addEventListener('keyup', handleGlobalKeyup, true);
}

// Handle global keydown when switcher is open
function handleGlobalKeydown(e) {
  // Track modifier key states
  if (e.key === 'Control') ctrlPressed = true;
  if (e.key === 'Meta') metaPressed = true;
  if (e.key === 'Shift') shiftPressed = true;
  if (e.key === 'Alt') altPressed = true;

  if (!switcherVisible) return;

  // Debug: log all keypresses when switcher is visible
  console.log('[ArcSwitcher] Key pressed:', e.key, 'Settings:', currentSettings.hotkeys);

  // Handle Escape to close switcher
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    hideSwitcher();
    return;
  }

  // Get the hotkey settings with fallbacks
  const hotkeys = currentSettings.hotkeys || {};
  const closeTabKey = (hotkeys.closeTab || 'w').toLowerCase();
  const nextTabKey = hotkeys.nextTab || 'ArrowRight';
  const prevTabKey = hotkeys.prevTab || 'ArrowLeft';

  // Handle close tab hotkey (default: W)
  if (e.key.toLowerCase() === closeTabKey) {
    console.log('[ArcSwitcher] Close tab hotkey triggered');
    e.preventDefault();
    e.stopPropagation();
    closeSelectedTab();
    return;
  }

  // Handle next tab hotkey (default: ArrowRight)
  if (e.key === nextTabKey) {
    e.preventDefault();
    e.stopPropagation();
    const filteredTabs = getFilteredTabs();
    if (filteredTabs.length > 0) {
      selectedIndex = (selectedIndex + 1) % filteredTabs.length;
      renderTabs();
    }
    return;
  }

  // Handle previous tab hotkey (default: ArrowLeft)
  if (e.key === prevTabKey) {
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

// Close the currently selected tab
function closeSelectedTab() {
  console.log('[ArcSwitcher] closeSelectedTab called, selectedIndex:', selectedIndex);

  const filteredTabs = getFilteredTabs();
  console.log('[ArcSwitcher] filteredTabs:', filteredTabs.length, 'tabs');

  if (filteredTabs.length === 0) {
    console.log('[ArcSwitcher] No tabs to close');
    return;
  }

  const tabToClose = filteredTabs[selectedIndex];
  if (!tabToClose) {
    console.log('[ArcSwitcher] No tab at selectedIndex');
    return;
  }

  console.log('[ArcSwitcher] Attempting to close tab:', tabToClose.id, tabToClose.title);

  // Don't allow closing the current tab (the one we're viewing from)
  if (tabToClose.id === currentTabId) {
    console.log('[ArcSwitcher] Cannot close current tab from switcher');
    return;
  }

  // Send message to background to close the tab
  chrome.runtime.sendMessage({
    action: "closeTab",
    tabId: tabToClose.id
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("[ArcSwitcher] Error closing tab:", chrome.runtime.lastError);
      return;
    }

    console.log('[ArcSwitcher] Tab closed successfully');

    // Remove the tab from our local list
    currentTabs = currentTabs.filter(t => t.id !== tabToClose.id);

    // Adjust selected index if needed
    if (selectedIndex >= currentTabs.length) {
      selectedIndex = Math.max(0, currentTabs.length - 1);
    }

    // If no tabs left, close switcher
    if (currentTabs.length === 0) {
      hideSwitcher();
      return;
    }

    // Re-render the tabs
    renderTabs();
  });
}

// Handle global keyup when switcher is open
function handleGlobalKeyup(e) {
  // Track modifier key states
  if (e.key === 'Control') ctrlPressed = false;
  if (e.key === 'Meta') metaPressed = false;  
  if (e.key === 'Shift') shiftPressed = false;
  if (e.key === 'Alt') altPressed = false;
  
  console.log('Key released:', e.key, 'Switcher visible:', switcherVisible);
  
  if (!switcherVisible) return;
  
  // When any modifier key is released, check if all modifier keys are released
  if (e.key === 'Control' || e.key === 'Meta' || e.key === 'Alt' || e.key === 'Shift') {
    e.preventDefault();
    console.log('Modifier key released. Ctrl:', ctrlPressed, 'Meta:', metaPressed, 'Alt:', altPressed, 'Shift:', shiftPressed);
    
    // Only switch if no modifier keys are being held (allow rapid cycling between shortcuts)
    if (!ctrlPressed && !metaPressed && !altPressed && !shiftPressed) {
      const filteredTabs = getFilteredTabs();
      console.log('Switching to tab at index:', selectedIndex, 'Tab ID:', filteredTabs[selectedIndex]?.id);
      if (filteredTabs[selectedIndex]) {
        // Cancel any timer and switch immediately
        if (autoSwitchTimer) {
          clearTimeout(autoSwitchTimer);
          autoSwitchTimer = null;
        }
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
  // Track modifier key states globally
  if (e.key === 'Control') ctrlPressed = true;
  if (e.key === 'Meta') metaPressed = true;
  if (e.key === 'Shift') shiftPressed = true;
  if (e.key === 'Alt') altPressed = true;
  
  // Prevent Ctrl+Q from triggering browser quit on Mac
  if ((e.metaKey || e.ctrlKey) && e.key === 'q') {
    e.preventDefault();
    e.stopPropagation();
  }
}, true);

// Global key release tracking
document.addEventListener('keyup', (e) => {
  // Track modifier key states globally
  if (e.key === 'Control') ctrlPressed = false;
  if (e.key === 'Meta') metaPressed = false;  
  if (e.key === 'Shift') shiftPressed = false;
  if (e.key === 'Alt') altPressed = false;
}, true);
