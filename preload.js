const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
    // Session Management
    startSession: (settings) => ipcRenderer.invoke('start-session', settings),
    stopSession: () => ipcRenderer.invoke('stop-session'),
    getSessionStatus: () => ipcRenderer.invoke('get-session-status'),
    
    // Enhanced App Management
    getInstalledApps: () => ipcRenderer.invoke('get-installed-apps'),
    scanAppsDeep: () => ipcRenderer.invoke('scan-apps-deep'),
    getDetectedApps: () => ipcRenderer.invoke('get-detected-apps'),
    searchApps: (query) => ipcRenderer.invoke('search-apps', query),
    
    // Enhanced App Addition Methods
    addAppManually: (appName, type, category) => ipcRenderer.invoke('add-app-manually', appName, type, category),
    addAppFromFile: (filePath, category) => ipcRenderer.invoke('add-app-from-file', filePath, category),
    addAppByPackage: (packageName, category) => ipcRenderer.invoke('add-app-by-package', packageName, category),
    
    // App List Management
    getSelectedApps: () => ipcRenderer.invoke('get-selected-apps'),
    getAllowedApps: () => ipcRenderer.invoke('get-allowed-apps'),
    getBlockedApps: () => ipcRenderer.invoke('get-blocked-apps'),
    addToSelected: (appName) => ipcRenderer.invoke('add-to-selected', appName),
    addToAllowed: (appName) => ipcRenderer.invoke('add-to-allowed', appName),
    addToBlocked: (appName) => ipcRenderer.invoke('add-to-blocked', appName),
    removeFromSelected: (appName) => ipcRenderer.invoke('remove-from-selected', appName),
    removeFromAllowed: (appName) => ipcRenderer.invoke('remove-from-allowed', appName),
    removeFromBlocked: (appName) => ipcRenderer.invoke('remove-from-blocked', appName),
    removeAppCompletely: (appName) => ipcRenderer.invoke('remove-app-completely', appName),
    
    // Session History and Settings
    getSessionHistory: () => ipcRenderer.invoke('get-session-history'),
    getSessionSettings: () => ipcRenderer.invoke('get-session-settings'),
    saveSessionSettings: (settings) => ipcRenderer.invoke('save-session-settings', settings),
    
    // App Approval
    handleAppApprovalResponse: (requestId, approved) => 
        ipcRenderer.invoke('handle-app-approval', requestId, approved),
    
    // Enhanced File Operations
    showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
    showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
    showFileDialog: (options) => ipcRenderer.invoke('show-file-dialog', options),
    
    // App Lists
    getAppLists: () => ipcRenderer.invoke('get-app-lists'),
    clearAllData: () => ipcRenderer.invoke('clear-all-data'),
    
    // Package Manager
    getOfficeApps: () => ipcRenderer.invoke('get-office-apps'),
    
    // External Links
    openExternalLink: (url) => ipcRenderer.invoke('open-external-link', url),
    
    // App Readiness
    appReady: () => ipcRenderer.invoke('app-ready'),
    
    // Session Statistics
    getSessionStats: () => ipcRenderer.invoke('get-session-stats'),
    
    // Event listeners
    onSessionUpdate: (callback) => ipcRenderer.on('session-update', callback),
    onSessionEnd: (callback) => ipcRenderer.on('session-end', callback),
    onAppApprovalRequest: (callback) => ipcRenderer.on('app-approval-request', callback),
    onAppsBroughtToFront: (callback) => ipcRenderer.on('apps-brought-to-front', callback),
    onAppBlocked: (callback) => ipcRenderer.on('app-blocked', callback),
    onBlockedAppsClosed: (callback) => ipcRenderer.on('blocked-apps-closed', callback),
    onSessionStarted: (callback) => ipcRenderer.on('session-started', callback),
    onAppApprovalResponse: (callback) => ipcRenderer.on('app-approval-response', callback),
    
    // Remove listeners
    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});

// Add any other utilities you want to expose to the renderer
contextBridge.exposeInMainWorld('appUtils', {
    platform: process.platform,
    version: process.versions.electron,
    isWindows: process.platform === 'win32',
    isMac: process.platform === 'darwin',
    isLinux: process.platform === 'linux'
});