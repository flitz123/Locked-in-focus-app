const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Session Management
    startSession: (settings) => ipcRenderer.invoke('start-session', settings),
    stopSession: () => ipcRenderer.invoke('stop-session'),
    getSessionStatus: () => ipcRenderer.invoke('get-session-status'),
    getSessionStats: () => ipcRenderer.invoke('get-session-stats'),

    // App Scanning & Detection
    scanApps: () => ipcRenderer.invoke('scan-apps'),
    searchApps: (query) => ipcRenderer.invoke('search-apps', query),
    getInstalledApps: () => ipcRenderer.invoke('get-installed-apps'),
    browseSystemApps: () => ipcRenderer.invoke('browse-system-apps'),
    getOfficeApps: () => ipcRenderer.invoke('get-office-apps'),

    // App List Operations
    getAppLists: () => ipcRenderer.invoke('get-app-lists'),
    addAppManually: (appName, category, appType) => ipcRenderer.invoke('add-app-manually', appName, category, appType),
    removeApp: (appName) => ipcRenderer.invoke('remove-app', appName),
    addAppFromFile: (filePath, category) => ipcRenderer.invoke('add-app-from-file', filePath, category),
    addAppByPackage: (packageName, category) => ipcRenderer.invoke('add-app-by-package', packageName, category),

    // Dialogs & Data
    showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
    showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
    clearAllData: () => ipcRenderer.invoke('clear-all-data'),
    loadData: () => ipcRenderer.invoke('load-data'),
    saveData: () => ipcRenderer.invoke('save-data'),
    openExternal: (url) => ipcRenderer.invoke('open-external', url),

    // Approval Handlers
    handleAppApproval: (requestId, approved) => ipcRenderer.invoke('handle-app-approval', requestId, approved),

    // Event Listeners
    onSessionUpdate: (callback) => ipcRenderer.on('session-update', (event, data) => callback(data)),
    onSessionSummary: (callback) => ipcRenderer.on('session-summary', (event, data) => callback(data)),
    onFocusUpdate: (callback) => ipcRenderer.on('focus-update', (event, data) => callback(data)),
    onAppApprovalRequest: (callback) => ipcRenderer.on('app-approval-request', (event, data) => callback(data)),
    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});