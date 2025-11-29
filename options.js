// Options page script for Arc Tab Switcher

const SETTINGS_KEY = 'arcTabSwitcherSettings';

// Default settings
const defaultSettings = {
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

// Map key codes to display names
function getKeyDisplayName(key) {
  const keyMap = {
    'ArrowUp': 'Arrow Up',
    'ArrowDown': 'Arrow Down',
    'ArrowLeft': 'Arrow Left',
    'ArrowRight': 'Arrow Right',
    'Backspace': 'Backspace',
    'Delete': 'Delete',
    'Enter': 'Enter',
    'Tab': 'Tab',
    'Space': 'Space',
    ' ': 'Space'
  };
  return keyMap[key] || key.toUpperCase();
}

// Load settings from storage
async function loadSettings() {
  try {
    const result = await chrome.storage.local.get(SETTINGS_KEY);
    const saved = result[SETTINGS_KEY] || {};
    return {
      ...defaultSettings,
      ...saved,
      hotkeys: { ...defaultSettings.hotkeys, ...(saved.hotkeys || {}) }
    };
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

  // Hotkeys
  const hotkeys = settings.hotkeys || defaultSettings.hotkeys;
  document.querySelector('#hotkeyCloseTab .hotkey-value').textContent = getKeyDisplayName(hotkeys.closeTab);
  document.querySelector('#hotkeyNextTab .hotkey-value').textContent = getKeyDisplayName(hotkeys.nextTab);
  document.querySelector('#hotkeyPrevTab .hotkey-value').textContent = getKeyDisplayName(hotkeys.prevTab);
}

// Setup hotkey recording for a button
function setupHotkeyButton(btn, settings) {
  const action = btn.dataset.action;
  let isRecording = false;

  btn.addEventListener('click', () => {
    if (isRecording) return;

    isRecording = true;
    btn.classList.add('recording');
    btn.querySelector('.hotkey-hint').textContent = 'Press a key...';

    const handleKeydown = async (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Ignore modifier keys alone
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
        return;
      }

      // Don't allow Escape as a hotkey (it's reserved for cancel)
      if (e.key === 'Escape') {
        // Cancel recording
        isRecording = false;
        btn.classList.remove('recording');
        btn.querySelector('.hotkey-hint').textContent = 'Click to change';
        document.removeEventListener('keydown', handleKeydown, true);
        return;
      }

      // Save the new hotkey
      settings.hotkeys[action] = e.key;
      await saveSettings(settings);

      // Update UI
      btn.querySelector('.hotkey-value').textContent = getKeyDisplayName(e.key);
      btn.querySelector('.hotkey-hint').textContent = 'Click to change';
      btn.classList.remove('recording');
      isRecording = false;

      document.removeEventListener('keydown', handleKeydown, true);
    };

    document.addEventListener('keydown', handleKeydown, true);
  });
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

  // Setup hotkey buttons
  document.querySelectorAll('.hotkey-btn').forEach(btn => {
    setupHotkeyButton(btn, settings);
  });

  // Shortcuts link - open Chrome shortcuts page
  document.getElementById('shortcutsLink').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });
}

// Start when DOM is ready
document.addEventListener('DOMContentLoaded', init);
