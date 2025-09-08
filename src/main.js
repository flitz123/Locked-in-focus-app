const { app, BrowserWindow, ipcMain, dialog, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const isDev = require('electron-is-dev');

// Import the enhanced FocusManager - CORRECTED PATH
const FocusManager = require('./focusManager');

// Initialize app
let mainWindow;
const focusManager = new FocusManager();

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Someone tried to run a second instance, focus our window instead
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: '#2f3241',
    show: false,
    title: 'Locked In - Focus App',
    center: true,
    resizable: true,
    minimizable: true,
    maximizable: true
  });

  // Load the app - CORRECTED PATH
  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    focusManager.setMainWindow(mainWindow);
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Prevent new window creation
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  // Open dev tools in development
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }
}

// App event handlers
app.whenReady().then(async () => {
  // Initialize focus manager
  await focusManager.init();
  
  // Create main window
  createWindow();

  // Register global shortcuts
  globalShortcut.register('CommandOrControl+Shift+F', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  // Unregister all shortcuts
  globalShortcut.unregisterAll();
});

app.on('before-quit', async () => {
  // Stop any active session before quitting
  if (focusManager.isSessionActive) {
    await focusManager.stopSession();
  }
});

// Enhanced IPC handlers
ipcMain.handle('get-settings', async () => {
  try {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    try {
      const data = await fs.readFile(settingsPath, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      // Return default settings if file doesn't exist
      return {
        darkMode: false,
        duration: 25,
        notifications: true,
        autoStart: false
      };
    }
  } catch (err) {
    console.error('Error getting settings:', err);
    return {
      darkMode: false,
      duration: 25,
      notifications: true,
      autoStart: false
    };
  }
});

ipcMain.handle('save-settings', async (event, settings) => {
  try {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
    return { success: true };
  } catch (err) {
    console.error('Error saving settings:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-allowed-apps', async () => {
  try {
    return focusManager.getAllowList();
  } catch (err) {
    console.error('Error getting allowed apps:', err);
    return [];
  }
});

ipcMain.handle('get-blocked-apps', async () => {
  try {
    return focusManager.getBlockList();
  } catch (err) {
    console.error('Error getting blocked apps:', err);
    return [];
  }
});

ipcMain.handle('get-installed-apps', async () => {
  try {
    console.log('Starting comprehensive app search...');
    const apps = await focusManager.getInstalledApplications();
    console.log(`Found ${apps.length} applications`);
    
    // Group apps by type for better organization
    const groupedApps = {
      browsers: apps.filter(app => app.type === 'browser'),
      development: apps.filter(app => app.type === 'development'),
      communication: apps.filter(app => app.type === 'communication'),
      entertainment: apps.filter(app => app.type === 'entertainment'),
      creative: apps.filter(app => app.type === 'creative'),
      productivity: apps.filter(app => app.type === 'installed' && 
        (app.name.toLowerCase().includes('office') || 
         app.name.toLowerCase().includes('word') ||
         app.name.toLowerCase().includes('excel') ||
         app.name.toLowerCase().includes('powerpoint'))),
      system: apps.filter(app => app.type === 'system'),
      other: apps.filter(app => !['browser', 'development', 'communication', 'entertainment', 'creative', 'system'].includes(app.type) &&
        !(app.type === 'installed' && 
          (app.name.toLowerCase().includes('office') || 
           app.name.toLowerCase().includes('word') ||
           app.name.toLowerCase().includes('excel') ||
           app.name.toLowerCase().includes('powerpoint'))))
    };
    
    return {
      all: apps,
      grouped: groupedApps
    };
  } catch (err) {
    console.error('Error getting installed apps:', err);
    // Return fallback apps
    return {
      all: [
        { name: 'Google Chrome', type: 'browser' },
        { name: 'Mozilla Firefox', type: 'browser' },
        { name: 'Microsoft Edge', type: 'browser' },
        { name: 'Visual Studio Code', type: 'development' },
        { name: 'Notepad', type: 'system' },
        { name: 'Calculator', type: 'system' },
        { name: 'Discord', type: 'communication' },
        { name: 'Spotify', type: 'entertainment' }
      ],
      grouped: {}
    };
  }
});

ipcMain.handle('allow-application', async (event, appName) => {
  try {
    const result = focusManager.addToAllowList(appName);
    return { success: result };
  } catch (err) {
    console.error('Error allowing application:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('disallow-application', async (event, appName) => {
  try {
    const result = focusManager.removeFromAllowList(appName);
    return { success: result };
  } catch (err) {
    console.error('Error disallowing application:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('block-application', async (event, appName) => {
  try {
    const result = focusManager.addToBlockList(appName);
    return { success: result };
  } catch (err) {
    console.error('Error blocking application:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('unblock-application', async (event, appName) => {
  try {
    const result = focusManager.removeFromBlockList(appName);
    return { success: result };
  } catch (err) {
    console.error('Error unblocking application:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('start-focus-session', async (event, duration, allowedApps, blockedApps) => {
  try {
    if (!allowedApps || allowedApps.length === 0) {
      return { success: false, error: 'Please select at least one application to focus on' };
    }
    
    if (duration < 1 || duration > 480) { // Max 8 hours
      return { success: false, error: 'Duration must be between 1 and 480 minutes' };
    }
    
    console.log('Starting focus session with:', { duration, allowedApps, blockedApps });
    
    const session = await focusManager.startSession({
      duration: duration,
      allowedApps: allowedApps,
      blockedApps: blockedApps || []
    });
    
    return { success: true, session: session };
  } catch (err) {
    console.error('Error starting focus session:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('stop-focus-session', async () => {
  try {
    const session = await focusManager.stopSession();
    return { success: true, session: session };
  } catch (err) {
    console.error('Error stopping focus session:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-session-stats', async () => {
  try {
    return focusManager.getCurrentStats();
  } catch (err) {
    console.error('Error getting session stats:', err);
    return {
      blockedAttempts: 0,
      isActive: false,
      allowedAppsCount: 0,
      runningTime: 0
    };
  }
});

ipcMain.handle('app-choice-result', async (event, allowApp, appName) => {
  try {
    focusManager.handleAppChoice(allowApp, appName);
    // Emit the result for any waiting promises
    event.sender.emit('app-choice-result', allowApp, appName);
    return { success: true };
  } catch (err) {
    console.error('Error handling app choice:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-app-categories', async () => {
  return {
    'Browsers': ['Chrome', 'Firefox', 'Edge', 'Safari', 'Opera'],
    'Development': ['Visual Studio Code', 'Sublime Text', 'Atom', 'WebStorm', 'IntelliJ IDEA'],
    'Communication': ['Discord', 'Slack', 'Microsoft Teams', 'Zoom', 'Skype'],
    'Entertainment': ['Spotify', 'Netflix', 'YouTube', 'Steam', 'Epic Games'],
    'Productivity': ['Microsoft Word', 'Excel', 'PowerPoint', 'Notion', 'Obsidian'],
    'Creative': ['Photoshop', 'Illustrator', 'Blender', 'OBS Studio', 'Figma'],
    'System': ['Calculator', 'Notepad', 'File Explorer', 'Task Manager', 'Control Panel']
  };
});

// Manual app addition
ipcMain.handle('add-custom-app', async (event, appName, appType = 'other') => {
  try {
    if (!appName || appName.trim() === '') {
      return { success: false, error: 'App name cannot be empty' };
    }
    
    // Here you could add logic to validate if the app actually exists
    // For now, we'll just add it to a custom apps list
    const customAppsPath = path.join(app.getPath('userData'), 'custom-apps.json');
    
    let customApps = [];
    try {
      const data = await fs.readFile(customAppsPath, 'utf8');
      customApps = JSON.parse(data);
    } catch (err) {
      // File doesn't exist, start with empty array
    }
    
    const newApp = {
      name: appName.trim(),
      type: appType,
      custom: true,
      dateAdded: new Date().toISOString()
    };
    
    // Check if app already exists
    const exists = customApps.some(app => 
      app.name.toLowerCase() === newApp.name.toLowerCase()
    );
    
    if (exists) {
      return { success: false, error: 'App already exists in custom list' };
    }
    
    customApps.push(newApp);
    await fs.writeFile(customAppsPath, JSON.stringify(customApps, null, 2));
    
    return { success: true, app: newApp };
  } catch (err) {
    console.error('Error adding custom app:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-custom-apps', async () => {
  try {
    const customAppsPath = path.join(app.getPath('userData'), 'custom-apps.json');
    const data = await fs.readFile(customAppsPath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return []; // Return empty array if file doesn't exist
  }
});

// Error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('error', error.message);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('error', `Unhandled rejection: ${reason}`);
  }
});

// Handle app choice results (for the focus manager)
ipcMain.on('app-choice-result', (event, allowApp, appName) => {
  // This will be handled by the promise-based system in focusManager
  console.log(`App choice result: ${appName} - ${allowApp ? 'allowed' : 'denied'}`);
});