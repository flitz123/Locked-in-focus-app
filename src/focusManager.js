const { app, Notification, shell, BrowserWindow, dialog } = require('electron');
const fs = require('fs').promises;
const path = require('path');
const { exec, spawn } = require('child_process');
const isDev = require('electron-is-dev');

class FocusManager {
  constructor() {
    this.sessions = [];
    this.currentSession = null;
    this.monitorInterval = null;
    this.blockedProcesses = new Set();
    this.allowedProcesses = new Set();
    this.isSessionActive = false;
    this.processCheckInterval = 3000; // Check less frequently
    this.blockedAttempts = 0;
    this.allowedAppsCount = 0;
    this.sessionStartTime = 0;
    this.focusedTime = 0;
    this.distractedTime = 0;
    this.lastAppCheckTime = 0;
    this.currentApp = '';
    this.mainWindow = null;
    
    let dataPath;
    try {
      dataPath = app.getPath('userData');
    } catch (err) {
      if (isDev) {
        dataPath = path.join(__dirname, '..', 'data');
      } else {
        dataPath = path.join(process.resourcesPath, '..', 'data');
      }
    }
    
    (async () => {
      try {
        await fs.mkdir(dataPath, { recursive: true });
      } catch (err) {
        console.error('Failed to create data directory:', err);
      }
    })();
    
    this.dataPath = path.join(dataPath, 'sessions.json');
    this.blockListPath = path.join(dataPath, 'blocklist.json');
    this.allowListPath = path.join(dataPath, 'allowlist.json');
  }

  async init() {
    try {
      const dataDir = path.dirname(this.dataPath);
      await fs.mkdir(dataDir, { recursive: true });
      
      try {
        const data = await fs.readFile(this.dataPath, 'utf8');
        this.sessions = JSON.parse(data);
        console.log('Loaded', this.sessions.length, 'existing sessions');
      } catch (err) {
        console.log('No existing sessions found, starting fresh');
        this.sessions = [];
      }
      
      try {
        const blockData = await fs.readFile(this.blockListPath, 'utf8');
        const blockList = JSON.parse(blockData);
        blockList.forEach(app => this.blockedProcesses.add(app.toLowerCase()));
        console.log('Loaded', this.blockedProcesses.size, 'blocked applications');
      } catch (err) {
        console.log('No block list found, starting fresh');
        this.blockedProcesses = new Set();
      }
      
      try {
        const allowData = await fs.readFile(this.allowListPath, 'utf8');
        const allowList = JSON.parse(allowData);
        allowList.forEach(app => this.allowedProcesses.add(app.toLowerCase()));
        console.log('Loaded', this.allowedProcesses.size, 'allowed applications');
      } catch (err) {
        console.log('No allow list found, starting fresh');
        this.allowedProcesses = new Set();
      }
      
      return true;
    } catch (err) {
      console.error('Initialization error:', err);
      return false;
    }
  }

  async saveSessions() {
    try {
      await fs.writeFile(this.dataPath, JSON.stringify(this.sessions, null, 2));
      console.log('Sessions saved successfully');
    } catch (err) {
      console.error('Failed to save sessions:', err);
    }
  }

  async saveBlockList() {
    try {
      await fs.writeFile(this.blockListPath, JSON.stringify([...this.blockedProcesses], null, 2));
      console.log('Block list saved successfully');
    } catch (err) {
      console.error('Failed to save block list:', err);
    }
  }

  async saveAllowList() {
    try {
      await fs.writeFile(this.allowListPath, JSON.stringify([...this.allowedProcesses], null, 2));
      console.log('Allow list saved successfully');
    } catch (err) {
      console.error('Failed to save allow list:', err);
    }
  }

  async startSession(settings) {
    if (this.currentSession) {
      await this.stopSession();
    }

    this.currentSession = {
      ...settings,
      startTime: Date.now(),
      activeTime: 0,
      distractions: 0,
      blockedAttempts: 0,
      id: Date.now().toString()
    };
    
    this.allowedProcesses.clear();
    settings.allowedApps.forEach(app => {
      this.allowedProcesses.add(app.toLowerCase());
    });
    
    this.blockedProcesses.clear();
    settings.blockedApps.forEach(app => {
      this.blockedProcesses.add(app.toLowerCase());
    });
    
    // Save the lists
    await this.saveAllowList();
    await this.saveBlockList();
    
    this.isSessionActive = true;
    this.blockedAttempts = 0;
    this.sessionStartTime = Date.now();
    this.focusedTime = 0;
    this.distractedTime = 0;
    this.lastAppCheckTime = Date.now();
    this.currentApp = '';
    this.allowedAppsCount = settings.allowedApps.length;
    
    console.log('Starting focus session:', this.currentSession);
    
    this.monitorInterval = setInterval(() => {
      this.monitorUserActivity().catch(err => {
        console.error('Monitor process error:', err);
      });
    }, this.processCheckInterval);

    this.sessionTimeout = setTimeout(() => {
      if (this.currentSession && this.isSessionActive) {
        this.stopSession().catch(err => {
          console.error('Auto-stop error:', err);
        });
      }
    }, settings.duration * 60 * 1000);
    
    this.showNotification('Focus Session Started', 
      `Activity monitoring active for ${settings.duration} minutes. You'll be notified when opening distracting apps.`);
    
    return this.currentSession;
  }

  async monitorUserActivity() {
    if (!this.currentSession || !this.isSessionActive) return;

    try {
      const processes = await this.getRunningProcesses();
      const foregroundApp = await this.getForegroundApplication();
      
      const now = Date.now();
      const timeSinceLastCheck = now - this.lastAppCheckTime;
      
      // Update time tracking
      if (this.currentApp && this.allowedProcesses.has(this.currentApp.toLowerCase())) {
        this.focusedTime += timeSinceLastCheck;
      } else if (this.currentApp) {
        this.distractedTime += timeSinceLastCheck;
      }
      
      this.lastAppCheckTime = now;
      this.currentApp = foregroundApp;
      
      // Check for new non-allowed apps
      for (const process of processes) {
        const processName = process.name.toLowerCase();
        
        if (this.isSystemProcess(processName) || 
            processName.includes('locked in') || 
            processName.includes('electron')) {
          continue;
        }
        
        // Check if this is a new app that's not in the allowed list
        if (!this.allowedProcesses.has(processName) && !this.isSystemProcess(processName)) {
          const isBlocked = this.blockedProcesses.has(processName);
          
          // Notify the renderer process
          if (this.mainWindow) {
            this.mainWindow.webContents.send('app-attempt', {
              appName: process.name,
              isBlocked: isBlocked
            });
          }
          
          if (isBlocked) {
            this.blockedAttempts++;
            this.currentSession.blockedAttempts++;
          }
          
          console.log(`User attempted to open ${process.name} (${isBlocked ? 'blocked' : 'non-focused'})`);
        }
      }
      
    } catch (err) {
      console.error('Monitoring error:', err);
    }
  }

  async getRunningProcesses() {
    return new Promise((resolve, reject) => {
      if (process.platform === 'win32') {
        exec('tasklist /fo csv /nh', (error, stdout, stderr) => {
          if (error) {
            reject(error);
            return;
          }
          
          const processes = [];
          const lines = stdout.split('\n').filter(line => line.trim());
          
          for (const line of lines) {
            const columns = line.split('","').map(col => col.replace(/"/g, ''));
            if (columns.length >= 1) {
              const name = columns[0];
              const pid = parseInt(columns[1]) || Math.random() * 10000;
              
              if (name && name !== 'Image Name') {
                processes.push({
                  name: name.replace('.exe', ''),
                  pid: pid,
                  fullName: name
                });
              }
            }
          }
          
          resolve(processes);
        });
      } else {
        exec('ps -eo comm,pid,args', (error, stdout, stderr) => {
          if (error) {
            reject(error);
            return;
          }
          
          const processes = [];
          const lines = stdout.split('\n').filter(line => line.trim());
          
          for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].trim().split(/\s+/);
            if (parts.length >= 2) {
              processes.push({
                name: parts[0],
                pid: parseInt(parts[1]) || Math.random() * 10000,
                fullName: parts[0]
              });
            }
          }
          
          resolve(processes);
        });
      }
    });
  }

  async getForegroundApplication() {
    return new Promise((resolve, reject) => {
      if (process.platform === 'win32') {
        exec('powershell -command "(Get-Process | Where-Object { $_.MainWindowTitle -ne \"\" } | Select-Object -First 1).ProcessName"', 
        (error, stdout, stderr) => {
          if (error) {
            resolve('');
            return;
          }
          resolve(stdout.trim().replace('.exe', ''));
        });
      } else {
        // For macOS/Linux, we'll just return an empty string
        resolve('');
      }
    });
  }

  isSystemProcess(processName) {
    const systemProcesses = [
      'system', 'registry', 'smss', 'csrss', 'wininit', 'winlogon',
      'services', 'lsass', 'svchost', 'explorer', 'dwm', 'taskhost',
      'conhost', 'audiodg', 'spoolsv', 'winmgmt', 'wmiprvse',
      'dllhost', 'msiexec', 'rundll32', 'regsvr32', 'wuauclt',
      'searchindexer', 'werfault', 'wermgr', 'taskmgr', 'fontdrvhost',
      'unsecapp', 'runtimebroker', 'startmenuexperiencehost',
      'shellexperiencehost', 'textinputhost', 'lockapp', 'winstore',
      'applicationframehost', 'systemsettings', 'calculator',
      'ctfmon', 'sihost', 'igfxem', 'searchapp', 'securityhealthsystray'
    ];
    
    return systemProcesses.some(sysProc => 
      processName.includes(sysProc) || sysProc.includes(processName)
    );
  }

  async stopSession() {
    if (!this.currentSession) {
      console.log('No active session to stop');
      return null;
    }
    
    console.log('Stopping focus session');
    
    this.isSessionActive = false;
    
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    
    if (this.sessionTimeout) {
      clearTimeout(this.sessionTimeout);
      this.sessionTimeout = null;
    }
    
    // Calculate final time statistics
    const now = Date.now();
    const timeSinceLastCheck = now - this.lastAppCheckTime;
    
    if (this.currentApp && this.allowedProcesses.has(this.currentApp.toLowerCase())) {
      this.focusedTime += timeSinceLastCheck;
    } else if (this.currentApp) {
      this.distractedTime += timeSinceLastCheck;
    }
    
    this.currentSession.endTime = now;
    this.currentSession.totalDuration = this.currentSession.endTime - this.currentSession.startTime;
    this.currentSession.focusedTime = this.focusedTime;
    this.currentSession.distractedTime = this.distractedTime;
    this.currentSession.blockedAttempts = this.blockedAttempts;
    
    this.sessions.push({ ...this.currentSession });
    await this.saveSessions();
    
    const stoppedSession = this.currentSession;
    this.currentSession = null;
    
    // Send session report to renderer
    if (this.mainWindow) {
      this.mainWindow.webContents.send('session-end', {
        totalTime: stoppedSession.totalDuration,
        focusedTime: this.focusedTime,
        distractedTime: this.distractedTime,
        blockedAttempts: this.blockedAttempts
      });
    }
    
    const durationMinutes = Math.round(stoppedSession.totalDuration / 60000);
    this.showNotification('Session Complete', 
      `Focus session ended! Duration: ${durationMinutes} min. You had ${this.blockedAttempts} distraction attempts.`);
    
    return { ...stoppedSession };
  }

  showNotification(title, body) {
    try {
      if (Notification.isSupported()) {
        const notification = new Notification({ 
          title, 
          body,
          silent: false
        });
        notification.show();
      } else {
        console.log('Notification:', title, '-', body);
      }
    } catch (err) {
      console.error('Notification error:', err);
      console.log('Notification fallback:', title, '-', body);
    }
  }

  getSessions() {
    return {
      current: this.currentSession,
      history: this.sessions.slice(-50)
    };
  }

  getCurrentStats() {
    return {
      blockedAttempts: this.blockedAttempts,
      isActive: this.isSessionActive,
      allowedAppsCount: this.allowedAppsCount,
      runningTime: this.currentSession ? Date.now() - this.currentSession.startTime : 0
    };
  }

  getBlockList() {
    return [...this.blockedProcesses];
  }

  getAllowList() {
    return [...this.allowedProcesses];
  }

  addToBlockList(appName) {
    this.blockedProcesses.add(appName.toLowerCase());
    this.saveBlockList();
    return true;
  }

  removeFromBlockList(appName) {
    this.blockedProcesses.delete(appName.toLowerCase());
    this.saveBlockList();
    return true;
  }

  addToAllowList(appName) {
    this.allowedProcesses.add(appName.toLowerCase());
    this.saveAllowList();
    return true;
  }

  removeFromAllowList(appName) {
    this.allowedProcesses.delete(appName.toLowerCase());
    this.saveAllowList();
    return true;
  }

  setMainWindow(window) {
    this.mainWindow = window;
  }

  handleAppChoice(allowApp, appName) {
    if (allowApp) {
      console.log(`User chose to open ${appName} despite warning`);
      // User chose to open the app anyway - we don't need to do anything
    } else {
      console.log(`User chose to stay focused instead of opening ${appName}`);
      // User chose to stay focused - we don't need to do anything
    }
  }
}

module.exports = FocusManager;
