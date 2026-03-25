// Options page script for Tab Switcher Previews

const SETTINGS_KEY = 'tabSwitcherSettings';
const LEGACY_SETTINGS_KEY = 'arcTabSwitcherSettings';

// Default settings
const defaultSettings = {
  theme: 'dark',
  accentColor: 'blue',
  previewSize: 100,
  maxTabs: 'auto',
  showPreviews: true,
  peekModifier: 'Alt',
  peekSize: 75,
  peekBlur: 4
};

// Load settings from storage
async function loadSettings() {
  try {
    const result = await chrome.storage.local.get([SETTINGS_KEY, LEGACY_SETTINGS_KEY]);
    const settings = result[SETTINGS_KEY] || result[LEGACY_SETTINGS_KEY] || {};

    if (!result[SETTINGS_KEY] && result[LEGACY_SETTINGS_KEY]) {
      await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    }

    return { ...defaultSettings, ...settings };
  } catch (error) {
    console.error('Failed to load settings:', error);
    return defaultSettings;
  }
}

// Save settings to storage
async function saveSettings(settings) {
  try {
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    showSaveStatus('Settings saved');
  } catch (error) {
    console.error('Failed to save settings:', error);
    showSaveStatus('Failed to save', true);
  }
}

// Show save status message
let saveStatusTimeout = null;
function showSaveStatus(message, isError = false) {
  const statusEl = document.getElementById('saveStatus');
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#ef4444' : '#22c55e';
  statusEl.style.opacity = '1';

  if (saveStatusTimeout) {
    clearTimeout(saveStatusTimeout);
  }
  saveStatusTimeout = setTimeout(() => {
    statusEl.style.opacity = '0';
    saveStatusTimeout = null;
  }, 2000);
}

// Apply theme to options page body
function applyOptionsTheme(theme) {
  document.body.classList.remove('dark-theme', 'light-theme', 'auto-theme');
  if (theme === 'system') {
    document.body.classList.add('auto-theme');
  } else if (theme === 'light') {
    document.body.classList.add('light-theme');
  } else {
    document.body.classList.add('dark-theme');
  }
}

// Apply settings to UI
function applySettingsToUI(settings) {
  // Theme
  document.getElementById('theme').value = settings.theme;

  // Accent color
  document.querySelectorAll('.color-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.color === settings.accentColor);
  });

  // Preview size
  document.getElementById('previewSize').value = settings.previewSize;
  document.getElementById('previewSizeValue').textContent = settings.previewSize + '%';

  // Max tabs
  document.getElementById('maxTabs').value = settings.maxTabs;

  // Show previews
  document.getElementById('showPreviews').checked = settings.showPreviews;

  // Peek modifier
  document.getElementById('peekModifier').value = settings.peekModifier;

  // Peek size
  document.getElementById('peekSize').value = settings.peekSize;
  document.getElementById('peekSizeValue').textContent = settings.peekSize + '%';

  // Peek blur
  document.getElementById('peekBlur').value = settings.peekBlur;
  document.getElementById('peekBlurValue').textContent = settings.peekBlur + 'px';
}

// Initialize the options page
async function init() {
  const settings = await loadSettings();
  applySettingsToUI(settings);
  applyOptionsTheme(settings.theme);

  // Theme change
  document.getElementById('theme').addEventListener('change', async (e) => {
    settings.theme = e.target.value;
    applyOptionsTheme(settings.theme);
    await saveSettings(settings);
  });

  // Accent color change
  document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      settings.accentColor = btn.dataset.color;
      await saveSettings(settings);
    });
  });

  // Preview size change
  document.getElementById('previewSize').addEventListener('input', (e) => {
    document.getElementById('previewSizeValue').textContent = e.target.value + '%';
  });
  document.getElementById('previewSize').addEventListener('change', async (e) => {
    settings.previewSize = parseInt(e.target.value, 10);
    await saveSettings(settings);
  });

  // Max tabs change
  document.getElementById('maxTabs').addEventListener('change', async (e) => {
    settings.maxTabs = e.target.value;
    await saveSettings(settings);
  });

  // Show previews change
  document.getElementById('showPreviews').addEventListener('change', async (e) => {
    settings.showPreviews = e.target.checked;
    await saveSettings(settings);
  });

  // Peek modifier change
  document.getElementById('peekModifier').addEventListener('change', async (e) => {
    settings.peekModifier = e.target.value;
    await saveSettings(settings);
  });

  // Peek size change
  document.getElementById('peekSize').addEventListener('input', (e) => {
    document.getElementById('peekSizeValue').textContent = e.target.value + '%';
  });
  document.getElementById('peekSize').addEventListener('change', async (e) => {
    settings.peekSize = parseInt(e.target.value, 10);
    await saveSettings(settings);
  });

  // Peek blur change
  document.getElementById('peekBlur').addEventListener('input', (e) => {
    document.getElementById('peekBlurValue').textContent = e.target.value + 'px';
  });
  document.getElementById('peekBlur').addEventListener('change', async (e) => {
    settings.peekBlur = parseInt(e.target.value, 10);
    await saveSettings(settings);
  });

  // Shortcuts links - open Chrome shortcuts page
  document.getElementById('shortcutsLink').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });
  document.getElementById('shortcutsLinkTop').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });
}

// Start when DOM is ready
document.addEventListener('DOMContentLoaded', init);
