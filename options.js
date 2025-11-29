// Options page script for Arc Tab Switcher

const SETTINGS_KEY = 'arcTabSwitcherSettings';

// Default settings
const defaultSettings = {
  theme: 'dark',
  accentColor: 'blue',
  maxTabs: 'auto',
  showPreviews: true
};

// Load settings from storage
async function loadSettings() {
  try {
    const result = await chrome.storage.local.get(SETTINGS_KEY);
    return { ...defaultSettings, ...(result[SETTINGS_KEY] || {}) };
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
function showSaveStatus(message, isError = false) {
  const statusEl = document.getElementById('saveStatus');
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#ef4444' : '#22c55e';
  statusEl.style.opacity = '1';

  setTimeout(() => {
    statusEl.style.opacity = '0';
  }, 2000);
}

// Apply settings to UI
function applySettingsToUI(settings) {
  // Theme
  document.getElementById('theme').value = settings.theme;

  // Accent color
  document.querySelectorAll('.color-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.color === settings.accentColor);
  });

  // Max tabs
  document.getElementById('maxTabs').value = settings.maxTabs;

  // Show previews
  document.getElementById('showPreviews').checked = settings.showPreviews;
}

// Initialize the options page
async function init() {
  const settings = await loadSettings();
  applySettingsToUI(settings);

  // Theme change
  document.getElementById('theme').addEventListener('change', async (e) => {
    settings.theme = e.target.value;
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

  // Shortcuts link - open Chrome shortcuts page
  document.getElementById('shortcutsLink').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });
}

// Start when DOM is ready
document.addEventListener('DOMContentLoaded', init);
