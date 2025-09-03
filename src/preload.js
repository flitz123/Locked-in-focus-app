const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  
  // Applications
  getInstalledApps: () => ipcRenderer.invoke('get-installed-apps'),
  getAllowedApps: () => ipcRenderer.invoke('get-allowed-apps'),
  getBlockedApps: () => ipcRenderer.invoke('get-blocked-apps'),
  allowApplication: (appName) => ipcRenderer.invoke('allow-application', appName),
  disallowApplication: (appName) => ipcRenderer.invoke('disallow-application', appName),
  blockApplication: (appName) => ipcRenderer.invoke('block-application', appName),
  unblockApplication: (appName) => ipcRenderer.invoke('unblock-application', appName),
  
  // Focus sessions
  startFocusSession: (duration, allowedApps, blockedApps) => 
    ipcRenderer.invoke('start-focus-session', duration, allowedApps, blockedApps),
  stopFocusSession: () => ipcRenderer.invoke('stop-focus-session'),
  appChoiceResult: (allowApp, appName) => 
    ipcRenderer.invoke('app-choice-result', allowApp, appName),
  
  // Event listeners
  onAppAttempt: (callback) => ipcRenderer.on('app-attempt', callback),
  onSessionEnd: (callback) => ipcRenderer.on('session-end', callback),
  onError: (callback) => ipcRenderer.on('error', callback),
  
  // Cleanup
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});