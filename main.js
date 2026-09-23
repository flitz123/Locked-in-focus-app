const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const FocusManager = require('./focusManager');
const AppScanner = require('./appScanner');

let mainWindow;
let focusManager;
let appScanner;

function createWindow() {
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
        show: false
    });

    mainWindow.loadFile('index.html');

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        if (process.platform === 'darwin') {
            app.dock.show();
        }
        mainWindow.focus();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Initialize managers
    focusManager = new FocusManager();
    appScanner = new AppScanner();
    focusManager.setMainWindow(mainWindow);

    // Load initial data and scan apps automatically
    focusManager.loadData().then(() => {
        console.log('Focus manager data loaded');
        // Auto-scan apps on startup
        focusManager.getInstalledApps().then(result => {
            if (result.success) {
                console.log(`Auto-scanned ${result.apps.length} applications on startup`);
            }
        });
    });

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
        try {
            const result = await focusManager.getInstalledApps();
            return result;
        } catch (error) {
            console.error('Error scanning apps:', error);
            return { success: false, error: error.message, apps: [] };
        }
    });

    ipcMain.handle('search-apps', async (event, query) => {
        try {
            const result = await focusManager.getInstalledApps();
            if (result.success) {
                const filteredApps = result.apps.filter(app => 
                    app.name.toLowerCase().includes(query.toLowerCase()) ||
                    (app.type && app.type.toLowerCase().includes(query.toLowerCase()))
                );
                return filteredApps;
            }
            return [];
        } catch (error) {
            return [];
        }
    });

    // App management
    ipcMain.handle('add-app-manually', async (event, appName, category) => {
        return await focusManager.addAppManually(appName, 'User Added', category);
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
        return await appScanner.addAppFromFile(filePath, category);
    });

    ipcMain.handle('add-app-by-package', async (event, packageName, category) => {
        return await appScanner.addAppByPackageName(packageName, category);
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

    // Package manager - browse system for apps
    ipcMain.handle('browse-system-apps', async (event) => {
        try {
            const result = await focusManager.getInstalledApps();
            return result;
        } catch (error) {
            return { success: false, error: error.message, apps: [] };
        }
    });
}

// App event handlers
app.whenReady().then(() => {
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

module.exports = { focusManager, appScanner };