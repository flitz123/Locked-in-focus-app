const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const FocusManager = require('./focusManager');
const AppScanner = require('./appScanner');

let mainWindow;
let focusManager;
let appScanner;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 860,
        minWidth: 950,
        minHeight: 650,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        },
        icon: path.join(__dirname, 'assets', 'icon.png'),
        title: 'Locked-In Focus App',
        show: false,
        backgroundColor: '#0f172a'
    });

    mainWindow.loadFile('index.html');

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        if (process.platform === 'darwin') {
            app.dock.show();
        }
        mainWindow.focus();
    });

    // Handle window close when session is active
    mainWindow.on('close', async (e) => {
        if (focusManager && focusManager.sessionActive) {
            e.preventDefault();
            const choice = dialog.showMessageBoxSync(mainWindow, {
                type: 'question',
                buttons: ['End Session & View Summary', 'Cancel'],
                defaultId: 0,
                cancelId: 1,
                title: 'Active Focus Session',
                message: 'A focus session is currently running. Do you want to end the session and view your summary before closing?'
            });

            if (choice === 0) {
                await focusManager.stopSession();
                // After session summary is generated and saved, close window
                setTimeout(() => {
                    mainWindow.destroy();
                }, 500);
            }
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Initialize managers
    focusManager = new FocusManager();
    appScanner = new AppScanner();
    focusManager.setMainWindow(mainWindow);

    // Load initial data and scan apps
    focusManager.loadData().then(() => {
        console.log('Focus manager data loaded successfully');
    });

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

    // App scanning & detection
    ipcMain.handle('scan-apps', async (event) => {
        try {
            const result = await appScanner.scanForApps();
            return result;
        } catch (error) {
            console.error('Error scanning apps:', error);
            return { success: false, error: error.message, apps: [] };
        }
    });

    ipcMain.handle('search-apps', async (event, query) => {
        try {
            const result = await appScanner.scanForApps();
            if (result.success && Array.isArray(result.apps)) {
                const q = query.toLowerCase();
                const filtered = result.apps.filter(app =>
                    (app.name && app.name.toLowerCase().includes(q)) ||
                    (app.type && app.type.toLowerCase().includes(q)) ||
                    (app.publisher && app.publisher.toLowerCase().includes(q))
                );
                return filtered;
            }
            return [];
        } catch (error) {
            return [];
        }
    });

    // App lists & management
    ipcMain.handle('get-app-lists', async (event) => {
        return {
            selectedApps: Array.from(focusManager.selectedApps),
            allowedApps: Array.from(focusManager.allowedApps),
            blockedApps: Array.from(focusManager.blockedApps)
        };
    });

    ipcMain.handle('add-app-manually', async (event, appName, category = 'selected', appType = 'User Added') => {
        return await focusManager.addAppManually(appName, appType, category);
    });

    ipcMain.handle('remove-app', async (event, appName) => {
        return await focusManager.removeApp(appName);
    });

    ipcMain.handle('get-installed-apps', async (event) => {
        return await appScanner.scanForApps();
    });

    ipcMain.handle('get-session-stats', async (event) => {
        return focusManager.getSessionStats();
    });

    // File selection & upload
    ipcMain.handle('add-app-from-file', async (event, filePath, category = 'selected') => {
        return await appScanner.addAppFromFile(filePath, category);
    });

    ipcMain.handle('add-app-by-package', async (event, packageName, category = 'selected') => {
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

    // Dialogs
    ipcMain.handle('show-open-dialog', async (event, options) => {
        return await dialog.showOpenDialog(mainWindow, options || {
            title: 'Select Application File',
            properties: ['openFile', 'multiSelections'],
            filters: [
                { name: 'Applications & Executables', extensions: ['exe', 'lnk', 'bat', 'cmd', 'app'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });
    });

    ipcMain.handle('show-save-dialog', async (event, options) => {
        return await dialog.showSaveDialog(mainWindow, options);
    });

    // External shell links
    ipcMain.handle('open-external', async (event, url) => {
        await shell.openExternal(url);
    });

    // Office & Business apps curated list
    ipcMain.handle('get-office-apps', async (event) => {
        return [
            { name: 'Microsoft Word', type: 'Microsoft Office & Business', publisher: 'Microsoft' },
            { name: 'Microsoft Excel', type: 'Microsoft Office & Business', publisher: 'Microsoft' },
            { name: 'Microsoft PowerPoint', type: 'Microsoft Office & Business', publisher: 'Microsoft' },
            { name: 'Microsoft Outlook', type: 'Microsoft Office & Business', publisher: 'Microsoft' },
            { name: 'Microsoft OneNote', type: 'Microsoft Office & Business', publisher: 'Microsoft' },
            { name: 'Microsoft Teams', type: 'Microsoft Office & Business', publisher: 'Microsoft' },
            { name: 'Microsoft Access', type: 'Microsoft Office & Business', publisher: 'Microsoft' },
            { name: 'Microsoft 365 Copilot', type: 'Microsoft Office & Business', publisher: 'Microsoft' }
        ];
    });

    // Package manager browse
    ipcMain.handle('browse-system-apps', async (event) => {
        try {
            return await appScanner.scanForApps();
        } catch (error) {
            return { success: false, error: error.message, apps: [] };
        }
    });
}

// App lifecycle
if (app && app.whenReady) {
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
}

module.exports = { focusManager, appScanner };