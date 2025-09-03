const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const isDev = require('electron-is-dev');

// Import the FocusManager
const FocusManager = require('./focusManager');

// Initialize app
let mainWindow;
const focusManager = new FocusManager();

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

  // Load the app
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

app.on('before-quit', async () => {
  // Stop any active session before quitting
  if (focusManager.isSessionActive) {
    await focusManager.stopSession();
  }
});

// IPC handlers
ipcMain.handle('get-settings', async () => {
  try {
    const settingsPath = path.join(focusManager.dataPath, '..', 'settings.json');
    try {
      const data = await fs.readFile(settingsPath, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      // Return default settings if file doesn't exist
      return {
        darkMode: false,
        duration: 25
      };
    }
  } catch (err) {
    console.error('Error getting settings:', err);
    return {
      darkMode: false,
      duration: 25
    };
  }
});

ipcMain.handle('save-settings', async (event, settings) => {
  try {
    const settingsPath = path.join(focusManager.dataPath, '..', 'settings.json');
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
    return true;
  } catch (err) {
    console.error('Error saving settings:', err);
    return false;
  }
});

ipcMain.handle('get-allowed-apps', async () => {
  return focusManager.getAllowList();
});

ipcMain.handle('get-blocked-apps', async () => {
  return focusManager.getBlockList();
});

ipcMain.handle('get-installed-apps', async () => {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      exec('powershell -command "Get-StartApps | Select-Object Name | ConvertTo-Json"', 
      (error, stdout, stderr) => {
        if (error) {
          console.error('Error getting installed apps:', error);
          resolve([]);
          return;
        }
        
        try {
          const apps = JSON.parse(stdout);
          const uniqueApps = [];
          const seenApps = new Set();
          
          if (Array.isArray(apps)) {
            apps.forEach(app => {
              if (app.Name && !seenApps.has(app.Name)) {
                uniqueApps.push({ name: app.Name });
                seenApps.add(app.Name);
              }
            });
          }
          
          resolve(uniqueApps.slice(0, 50)); // Limit to 50 apps
        } catch (parseError) {
          console.error('Error parsing installed apps:', parseError);
          resolve([]);
        }
      });
    } else {
      // For non-Windows platforms, return a sample list
      resolve([
        { name: 'Chrome' },
        { name: 'Firefox' },
        { name: 'Word' },
        { name: 'Excel' },
        { name: 'PowerPoint' },
        { name: 'Outlook' },
        { name: 'Visual Studio Code' },
        { name: 'Spotify' },
        { name: 'Discord' },
        { name: 'Slack' }
      ]);
    }
  });
});

ipcMain.handle('allow-application', async (event, appName) => {
  return focusManager.addToAllowList(appName);
});

ipcMain.handle('disallow-application', async (event, appName) => {
  return focusManager.removeFromAllowList(appName);
});

ipcMain.handle('block-application', async (event, appName) => {
  return focusManager.addToBlockList(appName);
});

ipcMain.handle('unblock-application', async (event, appName) => {
  return focusManager.removeFromBlockList(appName);
});

ipcMain.handle('start-focus-session', async (event, duration, allowedApps, blockedApps) => {
  try {
    const session = await focusManager.startSession({
      duration: duration,
      allowedApps: allowedApps,
      blockedApps: blockedApps
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

ipcMain.handle('app-choice-result', async (event, allowApp, appName) => {
  focusManager.handleAppChoice(allowApp, appName);
  return { success: true };
});

// Error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  if (mainWindow) {
    mainWindow.webContents.send('error', error.message);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
