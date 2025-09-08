const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  
  // Applications management
  getInstalledApps: () => ipcRenderer.invoke('get-installed-apps'),
  getAllowedApps: () => ipcRenderer.invoke('get-allowed-apps'),
  getBlockedApps: () => ipcRenderer.invoke('get-blocked-apps'),
  allowApplication: (appName) => ipcRenderer.invoke('allow-application', appName),
  disallowApplication: (appName) => ipcRenderer.invoke('disallow-application', appName),
  blockApplication: (appName) => ipcRenderer.invoke('block-application', appName),
  unblockApplication: (appName) => ipcRenderer.invoke('unblock-application', appName),
  
  // Custom apps
  addCustomApp: (appName, appType) => ipcRenderer.invoke('add-custom-app', appName, appType),
  getCustomApps: () => ipcRenderer.invoke('get-custom-apps'),
  
  // Focus sessions
  startFocusSession: (duration, allowedApps, blockedApps) => 
    ipcRenderer.invoke('start-focus-session', duration, allowedApps, blockedApps),
  stopFocusSession: () => ipcRenderer.invoke('stop-focus-session'),
  getSessionStats: () => ipcRenderer.invoke('get-session-stats'),
  appChoiceResult: (allowApp, appName) => 
    ipcRenderer.invoke('app-choice-result', allowApp, appName),
  
  // Categories and utilities
  getAppCategories: () => ipcRenderer.invoke('get-app-categories'),
  
  // Event listeners for main process communications
  onAppAttempt: (callback) => {
    ipcRenderer.on('app-attempt', callback);
    return () => ipcRenderer.removeListener('app-attempt', callback);
  },
  
  onSessionEnd: (callback) => {
    ipcRenderer.on('session-end', callback);
    return () => ipcRenderer.removeListener('session-end', callback);
  },
  
  onError: (callback) => {
    ipcRenderer.on('error', callback);
    return () => ipcRenderer.removeListener('error', callback);
  },
  
  // Advanced session management
  onSessionUpdate: (callback) => {
    ipcRenderer.on('session-update', callback);
    return () => ipcRenderer.removeListener('session-update', callback);
  },
  
  onAppBlocked: (callback) => {
    ipcRenderer.on('app-blocked', callback);
    return () => ipcRenderer.removeListener('app-blocked', callback);
  },
  
  onAppAllowed: (callback) => {
    ipcRenderer.on('app-allowed', callback);
    return () => ipcRenderer.removeListener('app-allowed', callback);
  },
  
  // System information
  getPlatform: () => process.platform,
  getVersion: () => process.versions.electron,
  
  // Cleanup methods
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
  removeListener: (channel, callback) => ipcRenderer.removeListener(channel, callback),
  
  // Debug and logging (only available in development)
  isDev: () => {
    try {
      return require('electron-is-dev');
    } catch {
      return false;
    }
  },
  
  log: (...args) => {
    if (process.env.NODE_ENV === 'development') {
      console.log('[Renderer]', ...args);
    }
  },
  
  // Performance monitoring
  performance: {
    now: () => performance.now(),
    memory: () => performance.memory ? {
      usedJSHeapSize: performance.memory.usedJSHeapSize,
      totalJSHeapSize: performance.memory.totalJSHeapSize,
      jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
    } : null
  }
});