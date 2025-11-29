// Background service worker for Arc Tab Switcher

// Track MRU (Most Recently Used) tab order
let mruTabOrder = [];
const MRU_CACHE_KEY = 'mruTabOrderV1';

async function loadMRUOrder() {
  try {
    const stored = await chrome.storage.session.get(MRU_CACHE_KEY);
    const savedOrder = stored[MRU_CACHE_KEY];
    if (Array.isArray(savedOrder)) {
      mruTabOrder = savedOrder;
    }
  } catch (error) {
    console.warn('Failed to load MRU order', error);
  }
}

async function persistMRUOrder() {
  try {
    await chrome.storage.session.set({ [MRU_CACHE_KEY]: mruTabOrder });
  } catch (error) {
    console.warn('Failed to persist MRU order', error);
  }
}

function isRestrictedUrl(url = '') {
  return url.startsWith('chrome://') ||
         url.startsWith('chrome-extension://') ||
         url.startsWith('edge://') ||
         url.startsWith('about:') ||
         url.startsWith('devtools://');
}

// Persisted screenshot cache using local storage (survives browser restarts)
const SCREENSHOT_CACHE_KEY = 'tabScreenshotCacheV2'; // V2 for local storage migration
const MAX_SCREENSHOT_CACHE_ITEMS = 25;
let tabScreenshotCache = new Map(); // Map<tabId, { dataUrl, timestamp, url }>
const cacheInitPromise = loadScreenshotCache();

async function loadScreenshotCache() {
  try {
    const stored = await chrome.storage.local.get(SCREENSHOT_CACHE_KEY);
    const entries = stored[SCREENSHOT_CACHE_KEY];
    if (entries && typeof entries === 'object') {
      Object.entries(entries).forEach(([id, entry]) => {
        if (entry && entry.dataUrl) {
          tabScreenshotCache.set(Number(id), entry);
        }
      });
    }
  } catch (error) {
    // Best-effort load; fall back to empty cache
    console.warn('Failed to load screenshot cache', error);
  }
}

async function persistScreenshotCache() {
  const plainObject = {};
  for (const [id, entry] of tabScreenshotCache.entries()) {
    plainObject[id] = entry;
  }
  try {
    await chrome.storage.local.set({ [SCREENSHOT_CACHE_KEY]: plainObject });
  } catch (error) {
    console.warn('Failed to persist screenshot cache', error);
  }
}

async function pruneScreenshotCache() {
  if (tabScreenshotCache.size <= MAX_SCREENSHOT_CACHE_ITEMS) return;
  const entries = Array.from(tabScreenshotCache.entries());
  entries.sort((a, b) => (a[1].timestamp || 0) - (b[1].timestamp || 0));
  while (tabScreenshotCache.size > MAX_SCREENSHOT_CACHE_ITEMS && entries.length) {
    const [oldestId] = entries.shift();
    tabScreenshotCache.delete(oldestId);
  }
  await persistScreenshotCache();
}

async function setScreenshot(tabId, dataUrl, url = null) {
  await cacheInitPromise; // ensure we loaded any prior state
  tabScreenshotCache.set(tabId, { dataUrl, timestamp: Date.now(), url });
  await pruneScreenshotCache();
  await persistScreenshotCache();
}

async function deleteScreenshot(tabId) {
  await cacheInitPromise;
  tabScreenshotCache.delete(tabId);
  await persistScreenshotCache();
}

function getScreenshot(tabId, url = null) {
  // First try by tab ID
  const entry = tabScreenshotCache.get(tabId);
  if (entry && entry.dataUrl) {
    return entry.dataUrl;
  }

  // Fall back to URL match (useful after browser restart when tab IDs change)
  if (url) {
    for (const [, cachedEntry] of tabScreenshotCache.entries()) {
      if (cachedEntry.url === url && cachedEntry.dataUrl) {
        return cachedEntry.dataUrl;
      }
    }
  }

  return null;
}

// Track if the switcher is currently visible (to avoid capturing it in screenshots)
let switcherVisible = false;

// Track pending screenshot captures to prevent race conditions
let pendingScreenshotCapture = null;
let lastCapturedTabId = null;

// Listen for tab activation to maintain MRU order and capture screenshot
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tabId = activeInfo.tabId;
  // Remove tab if it exists in the list
  mruTabOrder = mruTabOrder.filter(id => id !== tabId);
  // Add to front of list (most recent)
  mruTabOrder.unshift(tabId);
  // Keep a reasonable limit
  if (mruTabOrder.length > 100) {
    mruTabOrder = mruTabOrder.slice(0, 100);
  }
  persistMRUOrder();
  
  // Cancel any pending screenshot capture
  if (pendingScreenshotCapture) {
    clearTimeout(pendingScreenshotCapture);
    pendingScreenshotCapture = null;
  }
  
  // Capture screenshot of newly active tab after a delay
  // Don't capture if switcher is visible (would include switcher overlay in screenshot)
  pendingScreenshotCapture = setTimeout(async () => {
    if (switcherVisible) {
      return; // Skip capture while switcher is visible
    }
    
    // Double-check this is still the active tab
    try {
      const [currentActiveTab] = await chrome.tabs.query({ active: true, windowId: activeInfo.windowId });
      if (!currentActiveTab || currentActiveTab.id !== tabId) {
        // Tab is no longer active, don't capture
        return;
      }
      
      const tab = await chrome.tabs.get(tabId);
      if (tab && !isRestrictedUrl(tab.url)) {
        // Don't recapture the same tab immediately
        if (lastCapturedTabId === tabId) {
          return;
        }
        
        // Use regular captureVisibleTab for active tabs (faster, no debugger warning)
        const dataUrl = await chrome.tabs.captureVisibleTab(activeInfo.windowId, {
          format: 'jpeg',
          quality: 50
        });
        await setScreenshot(tabId, dataUrl, tab.url);
        lastCapturedTabId = tabId;
      }
    } catch (error) {
      // Ignore errors for restricted pages
    }
    
    pendingScreenshotCapture = null;
  }, 800); // Increased delay to 800ms to let page settle
});

// Listen for tab removal to clean up MRU list and cache
chrome.tabs.onRemoved.addListener((tabId) => {
  mruTabOrder = mruTabOrder.filter(id => id !== tabId);
  persistMRUOrder();
  deleteScreenshot(tabId);
  
  // Clear last captured tab if it was this one
  if (lastCapturedTabId === tabId) {
    lastCapturedTabId = null;
  }
});

// Listen for tab updates (URL changes, page load completion)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Capture screenshot when page finishes loading and tab is active
  // Don't capture if switcher is visible (would include switcher overlay in screenshot)
  if (changeInfo.status === 'complete' && tab.active && tab.windowId !== undefined && !switcherVisible) {
    // Wait a bit for page to fully render
    setTimeout(async () => {
      try {
        // Double-check tab is still active
        const [currentActiveTab] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
        if (!currentActiveTab || currentActiveTab.id !== tabId) {
          return;
        }
        
        if (!isRestrictedUrl(tab.url)) {
          const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
            format: 'jpeg',
            quality: 50
          });
          await setScreenshot(tabId, dataUrl, tab.url);
          lastCapturedTabId = tabId;
        }
      } catch (error) {
        // Ignore errors for restricted pages
      }
    }, 500);
  }
});

// Handle window focus changes
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // No window focused
    return;
  }
  // Update MRU order when switching windows
  chrome.tabs.query({ active: true, windowId: windowId }).then(tabs => {
    if (tabs.length > 0) {
      const tabId = tabs[0].id;
      mruTabOrder = mruTabOrder.filter(id => id !== tabId);
      mruTabOrder.unshift(tabId);
      persistMRUOrder();
    }
  });
});

// Initialize MRU list when extension loads
Promise.all([loadMRUOrder(), chrome.tabs.query({})]).then(([_, tabs]) => {
  const allTabIds = new Set(tabs.map(t => t.id));
  
  // Filter stored MRU to only include currently existing tabs
  let validMru = mruTabOrder.filter(id => allTabIds.has(id));
  
  // Identify currently active tabs
  const activeTabs = tabs.filter(t => t.active);
  const activeTabIds = new Set(activeTabs.map(t => t.id));

  // If we have no valid MRU (fresh install or cleared), build from scratch
  if (validMru.length === 0) {
     validMru = [...activeTabIds, ...tabs.filter(t => !activeTabIds.has(t.id)).map(t => t.id)];
  } else {
     // Ensure current active tab(s) are at the front
     validMru = validMru.filter(id => !activeTabIds.has(id));
     validMru = [...activeTabIds, ...validMru];
     
     // Append any other tabs that were not in MRU
     const knownIds = new Set(validMru);
     const unknownTabs = tabs.filter(t => !knownIds.has(t.id)).map(t => t.id);
     validMru = [...validMru, ...unknownTabs];
  }
  
  mruTabOrder = validMru;
  persistMRUOrder();
  
  // Capture screenshot of currently active tab in focused window
  const activeTab = tabs.find(t => t.active && t.windowId);
  if (activeTab && !isRestrictedUrl(activeTab.url)) {
    setTimeout(async () => {
      try {
        const dataUrl = await chrome.tabs.captureVisibleTab(activeTab.windowId, {
          format: 'jpeg',
          quality: 50
        });
        await setScreenshot(activeTab.id, dataUrl, activeTab.url);
      } catch (error) {
        // Ignore errors
      }
    }, 500);
  }
});

// Listen for keyboard command
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "tab-switcher-forward") {
    toggleTabSwitcher("forward");
  } else if (command === "tab-switcher-backward") {
    toggleTabSwitcher("backward");
  }
});

// Sort tabs by MRU order
function sortTabsByMRU(tabs) {
  // Create a map of tab IDs to tab objects for quick lookup
  const tabMap = new Map(tabs.map(tab => [tab.id, tab]));
  
  // First, add tabs in MRU order that exist in the current window
  const sortedTabs = [];
  const addedIds = new Set();
  
  for (const tabId of mruTabOrder) {
    if (tabMap.has(tabId)) {
      sortedTabs.push(tabMap.get(tabId));
      addedIds.add(tabId);
    }
  }
  
  // Then add any remaining tabs (ones not yet in MRU tracking)
  for (const tab of tabs) {
    if (!addedIds.has(tab.id)) {
      sortedTabs.push(tab);
    }
  }
  
  return sortedTabs;
}

// Check if content script is loaded and inject if needed
async function ensureContentScript(tabId) {
  try {
    // Try to ping the content script
    await chrome.tabs.sendMessage(tabId, { action: "ping" });
    return true;
  } catch (error) {
    // Content script not loaded, inject it
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      });
      
      // Give it a moment to initialize
      await new Promise(resolve => setTimeout(resolve, 50));
      return true;
    } catch (injectError) {
      console.error("Failed to inject content script:", injectError);
      return false;
    }
  }
}

// Toggle the tab switcher
async function toggleTabSwitcher(direction = "forward") {
  try {
    await cacheInitPromise; // ensure screenshot cache restored before building UI

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.id) {
      console.warn("No active tab found");
      return;
    }

    // Check if tab URL is a restricted page
    if (tab.url && isRestrictedUrl(tab.url)) {
      console.warn("Cannot run on restricted pages:", tab.url);
      return;
    }
    
    // Ensure content script is loaded
    const isLoaded = await ensureContentScript(tab.id);
    if (!isLoaded) {
      console.error("Could not load content script");
      return;
    }
    
    // Get all tabs in current window
    const allTabs = await chrome.tabs.query({ currentWindow: true });
    
    // Sort tabs by MRU order
    const sortedTabs = sortTabsByMRU(allTabs);
    
    // Optimization: Only send top 20 tabs to avoid massive payload with screenshots
    // The UI calculates max based on width, but 20 is a safe upper bound for 4k screens
    const tabsToSend = sortedTabs.slice(0, 20);
    
    // Attach cached screenshots to tabs (also try URL-based lookup for better cache hits)
    const tabsWithScreenshots = tabsToSend.map(t => ({
      ...t,
      screenshot: getScreenshot(t.id, t.url) || null
    }));
    
    // Send message to content script to show/hide switcher
    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: "toggleSwitcher",
        tabs: tabsWithScreenshots,
        currentTabId: tab.id,
        direction: direction
      });
    } catch (messageError) {
      console.error("Could not send message to tab:", messageError);
    }
  } catch (error) {
    console.error("Error toggling tab switcher:", error);
  }
}

// Listen for tab switching requests from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "switchToTab") {
    chrome.tabs.update(request.tabId, { active: true })
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Will respond asynchronously
  } else if (request.action === "closeTab") {
    chrome.tabs.remove(request.tabId)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Will respond asynchronously
  } else if (request.action === "getAllTabs") {
    chrome.tabs.query({ currentWindow: true })
      .then(tabs => sendResponse({ tabs: tabs }))
      .catch(error => sendResponse({ tabs: [], error: error.message }));
    return true; // Will respond asynchronously
  } else if (request.action === "switcherShown") {
    // Switcher is now visible - don't capture screenshots
    switcherVisible = true;
    sendResponse({ success: true });
  } else if (request.action === "switcherHidden") {
    // Switcher is now hidden - can capture screenshots again
    switcherVisible = false;
    
    // Capture screenshot of the newly active tab after switcher is hidden
    if (sender.tab && sender.tab.id) {
      setTimeout(async () => {
        try {
          const tab = await chrome.tabs.get(sender.tab.id);
          
          // Double-check this tab is still active
          const [currentActiveTab] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
          if (!currentActiveTab || currentActiveTab.id !== sender.tab.id) {
            return;
          }
          
          if (tab && tab.active && !isRestrictedUrl(tab.url)) {
            const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
              format: 'jpeg',
              quality: 50
            });
            await setScreenshot(sender.tab.id, dataUrl, tab.url);
            lastCapturedTabId = sender.tab.id;
          }
        } catch (error) {
          // Ignore errors
        }
      }, 500);
    }
    sendResponse({ success: true });
  }
});

// Open options page when extension icon is clicked
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});
