const { app, Notification, BrowserWindow, dialog } = require('electron');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const isDev = require('electron-is-dev');
const util = require('util');

const execAsync = util.promisify(exec);

/**
 * Manages focus sessions by monitoring and controlling application usage.
 */
class FocusManager {
  /**
   * Initializes FocusManager with default state and data paths.
   */
  constructor() {
    this.sessions = [];
    this.currentSession = null;
    this.monitorInterval = null;
    this.appControlInterval = null;
    this.blockedProcesses = new Set();
    this.allowedProcesses = new Set();
    this.allowedApps = new Map();
    this.isSessionActive = false;
    this.processCheckInterval = 2000; // Check every 2 seconds
    this.blockedAttempts = 0;
    this.allowedAppsCount = 0;
    this.sessionStartTime = 0;
    this.focusedTime = 0;
    this.distractedTime = 0;
    this.lastAppCheckTime = 0;
    this.currentApp = '';
    this.mainWindow = null;
    this.runningProcesses = new Map();
    this.allowedAppPaths = new Map();
    this.userApprovalPromises = new Map();
    this.installedApps = [];

    this.dataPath = this._getDataPath();
    this.sessionsPath = path.join(this.dataPath, 'sessions.json');
    this.blockListPath = path.join(this.dataPath, 'blocklist.json');
    this.allowListPath = path.join(this.dataPath, 'allowlist.json');

    this._createDataDirectory();
  }

  // --- Initialization Methods ---

  /**
   * Determines the data directory path based on environment.
   * @returns {string} Path to data directory
   */
  _getDataPath() {
    try {
      return app.getPath('userData');
    } catch (err) {
      return isDev
        ? path.join(__dirname, '..', 'data')
        : path.join(process.resourcesPath, '..', 'data');
    }
  }

  /**
   * Creates the data directory if it doesn't exist.
   * @private
   */
  async _createDataDirectory() {
    try {
      await fs.mkdir(this.dataPath, { recursive: true });
    } catch (err) {
      console.error('Failed to create data directory:', err);
    }
  }

  /**
   * Initializes FocusManager by loading sessions and lists.
   * @returns {Promise<boolean>} True if initialization succeeds
   */
  async init() {
    try {
      await fs.mkdir(path.dirname(this.dataPath), { recursive: true });
      await Promise.all([
        this.loadSessions(),
        this.loadBlockList(),
        this.loadAllowList(),
      ]);
      this.installedApps = await this.getInstalledApplications();
      console.log('FocusManager initialized successfully');
      return true;
    } catch (err) {
      console.error('Initialization error:', err);
      return false;
    }
  }

  /**
   * Loads existing sessions from file.
   * @private
   */
  async loadSessions() {
    try {
      const data = await fs.readFile(this.sessionsPath, 'utf8');
      this.sessions = JSON.parse(data);
      console.log('Loaded', this.sessions.length, 'existing sessions');
    } catch (err) {
      console.log('No existing sessions found, starting fresh');
      this.sessions = [];
    }
  }

  /**
   * Loads blocked applications list from file.
   * @private
   */
  async loadBlockList() {
    try {
      const blockData = await fs.readFile(this.blockListPath, 'utf8');
      const blockList = JSON.parse(blockData);
      this.blockedProcesses = new Set(blockList.map(app => app.toLowerCase()));
      console.log('Loaded', this.blockedProcesses.size, 'blocked applications');
    } catch (err) {
      console.log('No block list found, starting fresh');
      this.blockedProcesses = new Set();
    }
  }

  /**
   * Loads allowed applications list from file.
   * @private
   */
  async loadAllowList() {
    try {
      const allowData = await fs.readFile(this.allowListPath, 'utf8');
      const allowList = JSON.parse(allowData);
      this.allowedProcesses = new Set(allowList.map(app => app.toLowerCase()));
      console.log('Loaded', this.allowedProcesses.size, 'allowed applications');
    } catch (err) {
      console.log('No allow list found, starting fresh');
      this.allowedProcesses = new Set();
    }
  }

  // --- File Operations ---

  /**
   * Saves sessions to file.
   * @private
   */
  async saveSessions() {
    try {
      await fs.writeFile(this.sessionsPath, JSON.stringify(this.sessions, null, 2));
      console.log('Sessions saved successfully');
    } catch (err) {
      console.error('Failed to save sessions:', err);
    }
  }

  /**
   * Saves blocked applications list to file.
   * @private
   */
  async saveBlockList() {
    try {
      await fs.writeFile(this.blockListPath, JSON.stringify([...this.blockedProcesses], null, 2));
      console.log('Block list saved successfully');
    } catch (err) {
      console.error('Failed to save block list:', err);
    }
  }

  /**
   * Saves allowed applications list to file.
   * @private
   */
  async saveAllowList() {
    try {
      await fs.writeFile(this.allowListPath, JSON.stringify([...this.allowedProcesses], null, 2));
      console.log('Allow list saved successfully');
    } catch (err) {
      console.error('Failed to save allow list:', err);
    }
  }

  // --- Session Management ---

  /**
   * Starts a new focus session with the given settings.
   * @param {Object} settings - Session settings
   * @returns {Promise<Object>} The started session
   */
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
      id: Date.now().toString(),
    };

    this._resetSessionState(settings);
    await Promise.all([this.saveAllowList(), this.saveBlockList()]);

    this.isSessionActive = true;
    console.log('Starting focus session:', this.currentSession);

    await this.bringAllowedAppsToForeground();
    await this.controlApplications();
    this._startMonitoring();
    this._setSessionTimeout(settings.duration);

    this.showNotification(
      'Focus Session Started',
      `Focus mode active for ${settings.duration} minutes. Selected apps brought to foreground.`
    );

    return this.currentSession;
  }

  /**
   * Resets session state with allowed and blocked apps.
   * @param {Object} settings - Session settings
   * @private
   */
  _resetSessionState(settings) {
    this.allowedProcesses.clear();
    this.allowedApps.clear();
    this.blockedProcesses.clear();
    settings.allowedApps.forEach(originalName => {
      const lower = originalName.toLowerCase();
      this.allowedProcesses.add(lower);
      const installed = this.installedApps.find(a => a.name.toLowerCase() === lower);
      this.allowedApps.set(lower, {
        name: originalName,
        path: installed ? installed.path : null
      });
    });
    settings.blockedApps.forEach(app => this.blockedProcesses.add(app.toLowerCase()));
    this.blockedAttempts = 0;
    this.sessionStartTime = Date.now();
    this.focusedTime = 0;
    this.distractedTime = 0;
    this.lastAppCheckTime = Date.now();
    this.currentApp = '';
    this.allowedAppsCount = settings.allowedApps.length;
  }

  /**
   * Starts monitoring intervals for user activity and app control.
   * @private
   */
  _startMonitoring() {
    this.monitorInterval = setInterval(async () => {
      try {
        await this.monitorUserActivity();
      } catch (err) {
        console.error('Monitor process error:', err);
      }
    }, this.processCheckInterval);

    this.appControlInterval = setInterval(async () => {
      try {
        await this.controlApplications();
      } catch (err) {
        console.error('App control error:', err);
      }
    }, this.processCheckInterval);
  }

  /**
   * Sets a timeout to automatically stop the session.
   * @param {number} duration - Session duration in minutes
   * @private
   */
  _setSessionTimeout(duration) {
    this.sessionTimeout = setTimeout(async () => {
      if (this.currentSession && this.isSessionActive) {
        try {
          await this.stopSession();
        } catch (err) {
          console.error('Auto-stop error:', err);
        }
      }
    }, duration * 60 * 1000);
  }

  /**
   * Stops the current focus session.
   * @returns {Promise<Object|null>} The stopped session or null if no session
   */
  async stopSession() {
    if (!this.currentSession) {
      console.log('No active session to stop');
      return null;
    }

    console.log('Stopping focus session');
    this.isSessionActive = false;
    this._clearIntervals();

    const stoppedSession = await this._finalizeSession();
    await this.saveSessions();

    this._notifySessionEnd(stoppedSession);
    this.currentSession = null;

    return { ...stoppedSession };
  }

  /**
   * Clears all active intervals and timeouts.
   * @private
   */
  _clearIntervals() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    if (this.appControlInterval) {
      clearInterval(this.appControlInterval);
      this.appControlInterval = null;
    }
    if (this.sessionTimeout) {
      clearTimeout(this.sessionTimeout);
      this.sessionTimeout = null;
    }
  }

  /**
   * Finalizes session statistics.
   * @returns {Object} The finalized session
   * @private
   */
  async _finalizeSession() {
    const now = Date.now();
    const timeSinceLastCheck = now - this.lastAppCheckTime;

    if (this.currentApp && this.allowedProcesses.has(this.currentApp.toLowerCase())) {
      this.focusedTime += timeSinceLastCheck;
    } else if (this.currentApp) {
      this.distractedTime += timeSinceLastCheck;
    }

    this.currentSession.endTime = now;
    this.currentSession.totalDuration = now - this.currentSession.startTime;
    this.currentSession.focusedTime = this.focusedTime;
    this.currentSession.distractedTime = this.distractedTime;
    this.currentSession.blockedAttempts = this.blockedAttempts;

    this.sessions.push({ ...this.currentSession });
    return this.currentSession;
  }

  /**
   * Notifies the user and renderer about session end.
   * @param {Object} session - The stopped session
   * @private
   */
  _notifySessionEnd(session) {
    if (this.mainWindow) {
      this.mainWindow.webContents.send('session-end', {
        totalTime: session.totalDuration,
        focusedTime: this.focusedTime,
        distractedTime: this.distractedTime,
        blockedAttempts: this.blockedAttempts,
      });
    }

    const durationMinutes = Math.round(session.totalDuration / 60000);
    this.showNotification(
      'Session Complete',
      `Focus session ended! Duration: ${durationMinutes} min. Blocked attempts: ${this.blockedAttempts}.`
    );
  }

  // --- Process Management ---

  /**
   * Retrieves a list of running processes.
   * @returns {Promise<Array>} List of process objects
   */
  async getRunningProcesses() {
    if (process.platform === 'win32') {
      try {
        const { stdout } = await execAsync(
          `powershell -WindowStyle Hidden -Command "
            Get-Process | Where-Object { $_.ProcessName -ne '' } | ForEach-Object {
              $hasWindow = $false;
              $windowTitle = '';
              try {
                if ($_.MainWindowHandle -ne [IntPtr]::Zero -and $_.MainWindowTitle -ne '') {
                  $hasWindow = $true;
                  $windowTitle = $_.MainWindowTitle;
                }
              } catch { }
              [PSCustomObject]@{
                Name = $_.ProcessName;
                Id = $_.Id;
                HasWindow = $hasWindow;
                Title = $windowTitle;
                Path = try { $_.Path } catch { '' };
              }
            } | Where-Object { $_.Name -ne 'System' -and $_.Name -ne 'Idle' } | ConvertTo-Json -Depth 2
          "`,
          { maxBuffer: 1024 * 1024 * 5 }
        );

        const trimmedOutput = stdout.trim();
        if (!trimmedOutput) return [];

        const data = trimmedOutput.startsWith('[')
          ? JSON.parse(trimmedOutput)
          : [JSON.parse(trimmedOutput)];

        return data.map(proc => ({
          name: proc.Name || '',
          pid: proc.Id || 0,
          hasWindow: proc.HasWindow || false,
          title: proc.Title || '',
          path: proc.Path || '',
        })).filter(proc => proc.name);
      } catch (error) {
        console.error('PowerShell process query failed, falling back to tasklist:', error);
        return this._fallbackToTasklist();
      }
    } else {
      return this._getUnixProcesses();
    }
  }

  /**
   * Fallback method to retrieve processes using tasklist on Windows.
   * @returns {Promise<Array>} List of process objects
   * @private
   */
  async _fallbackToTasklist() {
    try {
      const { stdout } = await execAsync('tasklist /fo csv /nh');
      const processes = [];
      const lines = stdout.split('\n').filter(line => line.trim());

      for (const line of lines) {
        const parts = line.split('","');
        if (parts.length >= 2) {
          processes.push({
            name: parts[0].replace(/"/g, ''),
            pid: parseInt(parts[1].replace(/"/g, ''), 10) || 0,
            hasWindow: false, // Can't determine easily
            title: '',
            path: '',
          });
        }
      }
      return processes;
    } catch (err) {
      console.error('Tasklist fallback failed:', err);
      return [];
    }
  }

  /**
   * Retrieves running processes on Unix-like systems.
   * @returns {Promise<Array>} List of process objects
   * @private
   */
  async _getUnixProcesses() {
    try {
      if (process.platform === 'darwin') {
        const { stdout } = await execAsync('ls /Applications');
        const apps = stdout.split('\n').filter(app => app.endsWith('.app')).map(app => app.replace('.app', ''));

        const processes = [];
        for (const app of apps) {
          const { stdout: pidOut } = await execAsync(`pgrep -f "${app}"`);
          const pids = pidOut.trim().split('\n').filter(Boolean);
          if (pids.length > 0) {
            processes.push({
              name: app,
              pid: parseInt(pids[0], 10),
              hasWindow: true, // Assume has window
              title: '',
              path: `/Applications/${app}.app`,
            });
          }
        }
        return processes;
      } else {
        // Linux
        const { stdout } = await execAsync('ps -eo pid,comm');
        return stdout.split('\n').slice(1).filter(Boolean).map(line => {
          const [pid, name] = line.trim().split(/\s+/);
          return {
            name: path.basename(name),
            pid: parseInt(pid, 10),
            hasWindow: false, // TODO: Better detection
            title: '',
            path: name,
          };
        });
      }
    } catch (err) {
      console.error('Unix process query failed:', err);
      return [];
    }
  }

  /**
   * Retrieves installed applications.
   * @returns {Promise<Array>} List of installed application objects
   */
  async getInstalledApplications() {
    if (process.platform === 'win32') {
      try {
        const registryPaths = [
          'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
          'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
          'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
        ];

        const commands = registryPaths.map(regPath =>
          `reg query "${regPath}" /s | Select-String -Pattern "^HKEY" -Context 0,5`
        );

        const { stdout } = await execAsync(
          `powershell -Command "${commands.join('; ')}"`,
          { maxBuffer: 1024 * 1024 * 10 }
        );

        const apps = new Map();
        const lines = stdout.split('\n');
        let currentKey = '';
        let currentApp = {};

        lines.forEach(line => {
          line = line.trim();
          if (line.startsWith('HKEY')) {
            if (currentApp.name) {
              apps.set(currentApp.name.toLowerCase(), currentApp);
            }
            currentKey = line;
            currentApp = { type: 'installed' };
          } else if (line.includes('DisplayName')) {
            currentApp.name = line.split('    ').pop().trim();
          } else if (line.includes('InstallLocation')) {
            currentApp.path = line.split('    ').pop().trim();
          } else if (line.includes('DisplayIcon')) {
            let iconPath = line.split('    ').pop().trim();
            if (iconPath.endsWith(',0')) iconPath = iconPath.slice(0, -2);
            currentApp.icon = iconPath;
          }
        });

        if (currentApp.name) {
          apps.set(currentApp.name.toLowerCase(), currentApp);
        }

        // Add common apps that might not be in registry
        const commonApps = [
          { name: 'Notepad', path: '%SystemRoot%\\system32\\notepad.exe', type: 'system' },
          { name: 'Calculator', path: '%SystemRoot%\\system32\\calc.exe', type: 'system' },
          { name: 'Command Prompt', path: '%SystemRoot%\\system32\\cmd.exe', type: 'system' },
          { name: 'PowerShell', path: '%SystemRoot%\\system32\\WindowsPowerShell\\v1.0\\powershell.exe', type: 'system' },
          { name: 'File Explorer', path: '%SystemRoot%\\explorer.exe', type: 'system' },
          { name: 'Task Manager', path: '%SystemRoot%\\system32\\taskmgr.exe', type: 'system' },
          { name: 'Google Chrome', path: '%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe', type: 'browser' },
          { name: 'Mozilla Firefox', path: '%ProgramFiles%\\Mozilla Firefox\\firefox.exe', type: 'browser' },
          { name: 'Microsoft Edge', path: '%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe', type: 'browser' },
          { name: 'Visual Studio Code', path: '%LocalAppData%\\Programs\\Microsoft VS Code\\Code.exe', type: 'development' },
          { name: 'Discord', path: '%LocalAppData%\\Discord\\app\\Discord.exe', type: 'communication' },
          { name: 'Spotify', path: '%AppData%\\Spotify\\Spotify.exe', type: 'entertainment' },
        ];

        const allApps = new Set([...apps.keys()]);

        const expandedCommonApps = await Promise.all(
          commonApps.map(async app => {
            try {
              const { stdout } = await execAsync(`powershell -Command "Resolve-Path '${app.path}'"`);
              app.path = stdout.trim();
              return app;
            } catch {
              return null;
            }
          })
        );

        const validCommonApps = expandedCommonApps.filter(Boolean);

        const resultApps = [...apps.values(), ...validCommonApps.filter(app => !allApps.has(app.name.toLowerCase()))];

        resultApps.sort((a, b) => a.name.localeCompare(b.name));
        console.log(`Found ${resultApps.length} applications`);
        return resultApps;
      } catch (err) {
        console.error('Failed to get installed apps:', err);
        return [];
      }
    } else {
      return this._getDefaultApplications();
    }
  }

  /**
   * Returns default applications for non-Windows platforms.
   * @returns {Array} List of default application objects
   * @private
   */
  _getDefaultApplications() {
    return [
      { name: 'Google Chrome', path: '/Applications/Google Chrome.app', type: 'browser' },
      { name: 'Firefox', path: '/Applications/Firefox.app', type: 'browser' },
      { name: 'Safari', path: '/Applications/Safari.app', type: 'browser' },
      { name: 'Visual Studio Code', path: '/Applications/Visual Studio Code.app', type: 'development' },
      { name: 'Sublime Text', path: '/Applications/Sublime Text.app', type: 'development' },
      { name: 'Spotify', path: '/Applications/Spotify.app', type: 'entertainment' },
      { name: 'Discord', path: '/Applications/Discord.app', type: 'communication' },
      { name: 'Slack', path: '/Applications/Slack.app', type: 'communication' },
      { name: 'Terminal', path: '/Applications/Utilities/Terminal.app', type: 'system' },
      { name: 'TextEdit', path: '/Applications/TextEdit.app', type: 'system' },
    ];
  }

  /**
   * Brings allowed applications to the foreground.
   */
  async bringAllowedAppsToForeground() {
    console.log('Bringing allowed apps to foreground...');
    for (const lower of this.allowedProcesses) {
      const app = this.allowedApps.get(lower);
      if (!app || !app.path) continue;
      const originalName = app.name;
      const appPath = app.path;

      if (process.platform === 'win32') {
        const psCommand = `
          $app = Get-Process | Where-Object { $_.ProcessName -like '*${originalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}*' -or $_.MainWindowTitle -like '*${originalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}*' } | Select-Object -First 1;
          if ($app) {
            Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class Win32 { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow); }';
            [Win32]::ShowWindow($app.MainWindowHandle, 9);
            [Win32]::SetForegroundWindow($app.MainWindowHandle);
            Write-Output 'Activated: ' + $app.ProcessName;
          } else {
            Write-Output 'Not found: ${originalName}';
          }
        `;
        try {
          const { stdout } = await execAsync(`powershell -command "${psCommand}"`);
          const trim = stdout.trim();
          console.log(`App activation result for ${originalName}:`, trim);
          if (trim.startsWith('Not found:')) {
            try {
              exec(`start "" "${appPath}"`, (err) => {
                if (err) console.error(`Failed to open ${originalName}:`, err);
              });
              console.log(`Opened ${originalName}`);
              setTimeout(async () => {
                try {
                  const { stdout: stdout2 } = await execAsync(`powershell -command "${psCommand}"`);
                  console.log(`Activation after open for ${originalName}:`, stdout2.trim());
                } catch (err) {
                  console.error(`Failed to activate after open ${originalName}:`, err);
                }
              }, 3000);
            } catch (err) {
              console.error(`Failed to open ${originalName}:`, err);
            }
          }
        } catch (error) {
          console.error(`Could not activate ${originalName}:`, error.message);
        }
      } else if (process.platform === 'darwin') {
        try {
          await execAsync(`open -a "${originalName}"`);
          console.log(`Brought to front/opened: ${originalName}`);
        } catch (err) {
          console.error(`Failed to bring to front/open ${originalName}:`, err);
        }
      } else if (process.platform === 'linux') {
        try {
          await execAsync(`${appPath}`);
          console.log(`Opened: ${originalName}`);
        } catch (err) {
          console.error(`Failed to open ${originalName}:`, err);
        }
      }
    }
  }

  /**
   * Controls running applications, minimizing or closing non-allowed ones.
   */
  async controlApplications() {
    if (!this.currentSession || !this.isSessionActive) return;

    try {
      const processes = await this.getRunningProcesses();

      for (const process of processes) {
        const processName = process.name.toLowerCase();

        if (
          this.isSystemProcess(processName) ||
          processName.includes('locked in') ||
          processName.includes('electron')
        ) {
          continue;
        }

        if (!this.allowedProcesses.has(processName) && process.hasWindow) {
          const isBlocked = this.blockedProcesses.has(processName);
          const userDecision = await this.askUserPermission(process.name, isBlocked);

          if (!userDecision) {
            if (isBlocked) {
              await this.closeApplication(process);
            } else {
              await this.minimizeApplication(process);
            }
          }

          if (isBlocked && !userDecision) {
            this.blockedAttempts++;
            this.currentSession.blockedAttempts++;
          }
        }
      }
    } catch (err) {
      console.error('App control error:', err);
    }
  }

  /**
   * Asks user for permission to allow a non-allowed application.
   * @param {string} appName - Name of the application
   * @param {boolean} isBlocked - Whether the app is in the blocklist
   * @returns {Promise<boolean>} User's decision (true to allow, false to block)
   */
  async askUserPermission(appName, isBlocked) {
    if (this.userApprovalPromises.has(appName)) {
      return this.userApprovalPromises.get(appName);
    }

    const promise = new Promise((resolve) => {
      if (!this.mainWindow) {
        resolve(false);
        return;
      }

      this.mainWindow.webContents.send('app-attempt', { appName, isBlocked });

      const responseHandler = (event, allowApp, responseAppName) => {
        if (responseAppName === appName) {
          this.userApprovalPromises.delete(appName);
          resolve(allowApp);
          require('electron').ipcMain.removeListener('app-choice-result', responseHandler);
        }
      };

      require('electron').ipcMain.on('app-choice-result', responseHandler);

      setTimeout(() => {
        if (this.userApprovalPromises.has(appName)) {
          this.userApprovalPromises.delete(appName);
          resolve(false);
          require('electron').ipcMain.removeListener('app-choice-result', responseHandler);
        }
      }, 10000);
    });

    this.userApprovalPromises.set(appName, promise);
    return promise;
  }

  /**
   * Closes a specified application by PID.
   * @param {Object} process - Process object with pid and name
   */
  async closeApplication(process) {
    try {
      if (process.platform === 'win32') {
        await execAsync(`taskkill /PID ${process.pid} /F`);
      } else if (process.platform === 'darwin') {
        await execAsync(`osascript -e 'tell application "${process.name}" to quit'`);
      } else if (process.platform === 'linux') {
        await execAsync(`kill -9 ${process.pid}`);
      }
      console.log(`Closed blocked app: ${process.name}`);
    } catch (error) {
      console.error(`Could not close ${process.name}:`, error.message);
    }
  }

  /**
   * Minimizes a specified application.
   * @param {Object} process - Process object with pid and name
   */
  async minimizeApplication(process) {
    try {
      if (process.platform === 'win32') {
        await execAsync(
          `powershell -command "
            Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class Win32 { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow); }';
            $proc = Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue;
            if ($proc -and $proc.MainWindowHandle -ne [System.IntPtr]::Zero) {
              [Win32]::ShowWindow($proc.MainWindowHandle, 6);
            }
          "`
        );
      } else if (process.platform === 'darwin') {
        await execAsync(`osascript -e 'tell application "System Events" to set visible of process "${process.name}" to false'`);
      } // Linux minimize not implemented
      console.log(`Minimized non-focus app: ${process.name}`);
    } catch (error) {
      console.error(`Could not minimize ${process.name}:`, error.message);
    }
  }

  /**
   * Monitors user activity to track focused and distracted time.
   */
  async monitorUserActivity() {
    if (!this.currentSession || !this.isSessionActive) return;

    try {
      const foregroundApp = await this.getForegroundApplication();
      const now = Date.now();
      const timeSinceLastCheck = now - this.lastAppCheckTime;

      if (this.currentApp && this.allowedProcesses.has(this.currentApp.toLowerCase())) {
        this.focusedTime += timeSinceLastCheck;
      } else if (this.currentApp) {
        this.distractedTime += timeSinceLastCheck;
      }

      this.lastAppCheckTime = now;
      this.currentApp = foregroundApp;
    } catch (err) {
      console.error('Monitoring error:', err);
    }
  }

  /**
   * Checks if a process is a system process that should be ignored.
   * @param {string} processName - Name of the process
   * @returns {boolean} True if the process is a system process
   */
  isSystemProcess(processName) {
    const systemProcesses = [
      'system', 'registry', 'smss', 'csrss', 'wininit', 'winlogon', 'services',
      'lsass', 'svchost', 'explorer', 'dwm', 'taskhost', 'conhost', 'audiodg',
      'spoolsv', 'winmgmt', 'wmiprvse', 'dllhost', 'msiexec', 'rundll32',
      'regsvr32', 'wuauclt', 'searchindexer', 'werfault', 'wermgr', 'taskmgr',
      'fontdrvhost', 'unsecapp', 'runtimebroker', 'startmenuexperiencehost',
      'shellexperiencehost', 'textinputhost', 'lockapp', 'winstore',
      'applicationframehost', 'systemsettings', 'ctfmon', 'sihost', 'igfxem',
      'searchapp', 'securityhealthsystray', 'windows security',
      'antimalware service executable', 'msmpeng', 'nissrv', 'malwarebytes',
      'avast', 'avg', 'kaspersky', 'norton', 'powershell', 'powershell_ise',
      'cmd', 'wt', 'windowsterminal', 'node', 'npm', 'git', 'python', 'java',
      'javaw', 'locked in', 'electron', 'lockedin', 'focus-app', 'msedgewebview2',
      'webview2', 'vcredist', 'dotnet', 'mscorsvw', 'ngen', 'trustedinstaller',
      'tiworker',
    ];

    const procLower = processName.toLowerCase();
    return (
      systemProcesses.some(sysProc => {
        const sysLower = sysProc.toLowerCase();
        return (
          procLower === sysLower ||
          procLower.includes(sysLower) ||
          sysLower.includes(procLower)
        );
      }) ||
      procLower.length < 3 ||
      procLower.includes('microsoft') ||
      procLower.includes('windows') ||
      procLower.startsWith('ms') ||
      procLower.endsWith('svc') ||
      procLower.endsWith('srv')
    );
  }

  // --- Utility Methods ---

  /**
   * Displays a notification to the user.
   * @param {string} title - Notification title
   * @param {string} body - Notification body
   */
  showNotification(title, body) {
    try {
      if (Notification.isSupported()) {
        new Notification({ title, body, silent: false }).show();
      } else {
        console.log('Notification:', title, '-', body);
      }
    } catch (err) {
      console.error('Notification error:', err);
      console.log('Notification fallback:', title, '-', body);
    }
  }

  /**
   * Retrieves current and historical sessions.
   * @returns {Object} Current session and session history
   */
  getSessions() {
    return {
      current: this.currentSession,
      history: this.sessions.slice(-50),
    };
  }

  /**
   * Retrieves current session statistics.
   * @returns {Object} Session statistics
   */
  getCurrentStats() {
    return {
      blockedAttempts: this.blockedAttempts,
      isActive: this.isSessionActive,
      allowedAppsCount: this.allowedAppsCount,
      runningTime: this.currentSession ? Date.now() - this.currentSession.startTime : 0,
    };
  }

  /**
   * Retrieves the list of blocked processes.
   * @returns {Array} List of blocked process names
   */
  getBlockList() {
    return [...this.blockedProcesses];
  }

  /**
   * Retrieves the list of allowed processes.
   * @returns {Array} List of allowed process names
   */
  getAllowList() {
    return [...this.allowedProcesses];
  }

  /**
   * Adds an application to the blocklist.
   * @param {string} appName - Name of the application
   * @returns {boolean} True if added successfully
   */
  addToBlockList(appName) {
    this.blockedProcesses.add(appName.toLowerCase());
    this.saveBlockList();
    return true;
  }

  /**
   * Removes an application from the blocklist.
   * @param {string} appName - Name of the application
   * @returns {boolean} True if removed successfully
   */
  removeFromBlockList(appName) {
    this.blockedProcesses.delete(appName.toLowerCase());
    this.saveBlockList();
    return true;
  }

  /**
   * Adds an application to the allowlist.
   * @param {string} appName - Name of the application
   * @returns {boolean} True if added successfully
   */
  addToAllowList(appName) {
    this.allowedProcesses.add(appName.toLowerCase());
    this.saveAllowList();
    return true;
  }

  /**
   * Removes an application from the allowlist.
   * @param {string} appName - Name of the application
   * @returns {boolean} True if removed successfully
   */
  removeFromAllowList(appName) {
    this.allowedProcesses.delete(appName.toLowerCase());
    this.saveAllowList();
    return true;
  }

  /**
   * Sets the main window for IPC communication.
   * @param {BrowserWindow} window - Electron BrowserWindow
   */
  setMainWindow(window) {
    this.mainWindow = window;
  }

  /**
   * Handles user choice for allowing or blocking an application.
   * @param {boolean} allowApp - Whether to allow the app
   * @param {string} appName - Name of the application
   */
  handleAppChoice(allowApp, appName) {
    console.log(
      allowApp
        ? `User chose to open ${appName} despite warning`
        : `User chose staying focused instead of opening ${appName}`
    );
  }
}

module.exports = FocusManager;