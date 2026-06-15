const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const FocusManager = require('./focusManager');
const AppScanner = require('./appScanner');

// Keep a global reference of the window object
let mainWindow;
let focusManager;
let appScanner;
let isQuitting = false;

function createWindow() {
    // Create the browser window
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        },
        icon: path.join(__dirname, 'assets', 'icon.png'),
        title: 'Locked-In Focus App',
        show: false // Don't show until ready-to-show
    });

    // Load the app
    mainWindow.loadFile('index.html');

    // Show window when ready to prevent visual flash
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        
        // Focus the window
        if (process.platform === 'darwin') {
            app.dock.show();
        }
        mainWindow.focus();
    });

    mainWindow.on('close', async (event) => {
        if (isQuitting || !focusManager || !focusManager.sessionActive) {
            return;
        }

        event.preventDefault();
        const result = await focusManager.stopSession();
        if (result.success) {
            mainWindow.show();
            mainWindow.focus();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Initialize managers
    focusManager = new FocusManager();
    appScanner = new AppScanner();
    focusManager.setMainWindow(mainWindow);

    // Load initial data
    focusManager.loadData();

    // Setup IPC handlers
    setupIpcHandlers();
}

function setupIpcHandlers() {
    // Session management
    ipcMain.handle('start-session', async (event, settings) => {
        return await focusManager.startSession(settings);
    });

    ipcMain.handle('stop-session', async (event) => {
        return await focusManager.stopSession();
    });

    ipcMain.handle('get-session-status', async (event) => {
        return focusManager.getSessionStatus();
    });

    // App scanning and detection
    ipcMain.handle('scan-apps', async (event) => {
        const result = await appScanner.scanForApps();
        if (result.success) {
            focusManager.updateAppCatalog(result.apps);
        }
        return result;
    });

    ipcMain.handle('search-apps', async (event, query) => {
        return { success: true, apps: appScanner.searchApps(query) };
    });

    // App management
    ipcMain.handle('add-app-manually', async (event, appName, appTypeOrCategory = 'selected', maybeCategory) => {
        const category = maybeCategory || appTypeOrCategory;
        const appType = maybeCategory ? appTypeOrCategory : 'User Added';
        return await focusManager.addAppManually(appName, appType, category);
    });

    ipcMain.handle('remove-app', async (event, appName) => {
        return await focusManager.removeApp(appName);
    });

    ipcMain.handle('get-installed-apps', async (event) => {
        return await focusManager.getInstalledApps();
    });

    ipcMain.handle('get-session-stats', async (event) => {
        return focusManager.getSessionStats();
    });

    // File operations
    ipcMain.handle('add-app-from-file', async (event, filePath, category) => {
        const result = await appScanner.addAppFromFile(filePath, category);
        if (result.success) {
            focusManager.updateAppCatalog([result.app]);
            await focusManager.addAppManually(result.app.name, result.app.type, category);
        }
        return result;
    });

    ipcMain.handle('add-app-by-package', async (event, packageName, category) => {
        const result = await appScanner.addAppByPackageName(packageName, category);
        if (result.success) {
            focusManager.updateAppCatalog([result.app]);
            await focusManager.addAppManually(result.app.name, result.app.type, category);
        }
        return result;
    });

    // App approval handling
    ipcMain.handle('handle-app-approval', async (event, requestId, approved) => {
        return await focusManager.handleAppApprovalResponse(requestId, approved);
    });

    // Data management
    ipcMain.handle('clear-all-data', async (event) => {
        return await focusManager.clearAllData();
    });

    ipcMain.handle('load-data', async (event) => {
        return await focusManager.loadData();
    });

    ipcMain.handle('save-data', async (event) => {
        return await focusManager.saveData();
    });

    // File dialog
    ipcMain.handle('show-open-dialog', async (event, options) => {
        const result = await dialog.showOpenDialog(mainWindow, options);
        return result;
    });

    ipcMain.handle('show-file-dialog', async (event, options) => {
        return await dialog.showOpenDialog(mainWindow, options);
    });

    // Open external
    ipcMain.handle('open-external', async (event, url) => {
        await shell.openExternal(url);
    });

    // Get app lists
    ipcMain.handle('get-app-lists', async (event) => {
        return {
            selectedApps: Array.from(focusManager.selectedApps),
            allowedApps: Array.from(focusManager.allowedApps),
            blockedApps: Array.from(focusManager.blockedApps)
        };
    });

    // Get office apps
    ipcMain.handle('get-office-apps', async (event) => {
        const officeApps = [
            { name: 'Microsoft Word', type: 'Microsoft Office' },
            { name: 'Microsoft Excel', type: 'Microsoft Office' },
            { name: 'Microsoft PowerPoint', type: 'Microsoft Office' },
            { name: 'Microsoft Outlook', type: 'Microsoft Office' },
            { name: 'Microsoft OneNote', type: 'Microsoft Office' },
            { name: 'Microsoft Teams', type: 'Microsoft Office' }
        ];
        return officeApps;
    });
}

// App event handlers
app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        // On macOS, re-create window when dock icon is clicked
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    // On macOS, keep app running even when all windows are closed
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', async () => {
    isQuitting = true;
    // Stop any active session before quitting
    if (focusManager && focusManager.sessionActive) {
        await focusManager.stopSession();
    }
});

// Security: Prevent navigation to external URLs
app.on('web-contents-created', (event, contents) => {
    contents.on('will-navigate', (event, navigationUrl) => {
        const parsedUrl = new URL(navigationUrl);
        
        if (parsedUrl.origin !== 'file://') {
            event.preventDefault();
        }
    });
});

// Export for testing
module.exports = { focusManager, appScanner };
