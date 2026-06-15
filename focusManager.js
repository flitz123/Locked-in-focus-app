const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const activeWindow = require('active-win');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class FocusManager {
    constructor() {
        this.mainWindow = null;
        this.sessionActive = false;
        this.currentSession = null;
        this.sessionInterval = null;
        this.selectedApps = new Set();
        this.allowedApps = new Set();
        this.blockedApps = new Set();
        this.sessionStats = [];
        this.pendingApprovals = new Map();
        this.dataPath = path.join(app.getPath('userData'), 'focus-app-data.json');
        this.appCatalog = new Map();
        this.protectedProcessNames = new Set([
            'locked-in-focus-app',
            'electron',
            'explorer',
            'dwm',
            'sihost',
            'shellexperiencehost',
            'searchhost',
            'startmenuexperiencehost',
            'taskhostw',
            'applicationframehost'
        ]);
        
        // Session tracking
        this.sessionStartTime = null;
        this.focusedTime = 0;
        this.distractedTime = 0;
        this.blockedCount = 0;
        this.lastWindowCheck = null;
        this.currentActiveApp = null;
        this.distractionApps = new Map(); // Track time spent on distraction apps
        this.openedApps = new Set(); // Track apps we've opened
        this.blockedAttemptWindows = new Map();
    }

    setMainWindow(window) {
        this.mainWindow = window;
    }

    async loadData() {
        try {
            const data = await fs.readFile(this.dataPath, 'utf8');
            const parsed = JSON.parse(data);
            
            this.selectedApps = new Set(parsed.selectedApps || []);
            this.allowedApps = new Set(parsed.allowedApps || []);
            this.blockedApps = new Set(parsed.blockedApps || []);
            this.sessionStats = parsed.sessionStats || [];
            
            console.log('Data loaded successfully');
            return { success: true };
        } catch (error) {
            console.log('No existing data found, starting fresh');
            // Initialize with default data
            await this.saveData();
            return { success: true };
        }
    }

    async saveData() {
        try {
            const data = {
                selectedApps: Array.from(this.selectedApps),
                allowedApps: Array.from(this.allowedApps),
                blockedApps: Array.from(this.blockedApps),
                sessionStats: this.sessionStats
            };
            
            await fs.writeFile(this.dataPath, JSON.stringify(data, null, 2));
            console.log('Data saved successfully');
            return { success: true };
        } catch (error) {
            console.error('Error saving data:', error);
            return { success: false, error: error.message };
        }
    }

    async startSession(settings) {
        if (this.sessionActive) {
            return { success: false, error: 'Session already active' };
        }

        if (this.selectedApps.size === 0) {
            return { success: false, error: 'No selected applications' };
        }

        try {
            this.sessionActive = true;
            this.sessionStartTime = Date.now();
            this.focusedTime = 0;
            this.distractedTime = 0;
            this.blockedCount = 0;
            this.lastWindowCheck = Date.now();
            this.distractionApps.clear();
            this.openedApps.clear();
            this.blockedAttemptWindows.clear();

            this.currentSession = {
                id: Date.now().toString(),
                name: settings.name,
                startTime: this.sessionStartTime,
                settings: settings,
                selectedApps: Array.from(this.selectedApps)
            };

            await this.refreshAppCatalog();

            // Bring selected apps to foreground
            await this.bringSelectedAppsToForeground();

            this.pushMainWindowToBackground();

            // Start monitoring
            this.startWindowMonitoring(settings.checkInterval || 2000);

            // Notify renderer
            if (this.mainWindow) {
                this.mainWindow.webContents.send('session-update', { 
                    active: true,
                    session: this.currentSession 
                });
            }

            return { 
                success: true, 
                sessionId: this.currentSession.id,
                message: 'Session started successfully'
            };
        } catch (error) {
            console.error('Error starting session:', error);
            this.sessionActive = false;
            return { success: false, error: error.message };
        }
    }

    async stopSession() {
        if (!this.sessionActive) {
            return { success: false, error: 'No active session' };
        }

        try {
            this.sessionActive = false;
            clearInterval(this.sessionInterval);

            const sessionEndTime = Date.now();
            const totalDuration = (sessionEndTime - this.sessionStartTime) / 1000;
            
            // Calculate productivity score
            const productivity = totalDuration > 0 ? 
                Math.round((this.focusedTime / totalDuration) * 100) : 0;

            // Calculate distraction app times
            const distractionDetails = Array.from(this.distractionApps.entries()).map(([appName, time]) => ({
                appName,
                timeSpent: time
            }));

            const sessionSummary = {
                sessionId: this.currentSession.id,
                sessionName: this.currentSession.name,
                startTime: this.sessionStartTime,
                endTime: sessionEndTime,
                totalDuration: totalDuration,
                focusedTime: this.focusedTime,
                distractedTime: this.distractedTime,
                blockedCount: this.blockedCount,
                productivity: productivity,
                selectedApps: Array.from(this.selectedApps),
                distractionDetails: distractionDetails
            };

            // Save to session history
            this.sessionStats.push(sessionSummary);
            await this.saveData();

            // Reset session data
            this.currentSession = null;
            this.sessionStartTime = null;

            // Notify renderer
            if (this.mainWindow) {
                this.mainWindow.webContents.send('session-update', { active: false });
                this.mainWindow.webContents.send('session-summary', sessionSummary);
                if (this.mainWindow.isMinimized()) {
                    this.mainWindow.restore();
                }
                this.mainWindow.show();
                this.mainWindow.focus();
            }

            return { 
                success: true, 
                summary: sessionSummary,
                message: 'Session stopped successfully'
            };
        } catch (error) {
            console.error('Error stopping session:', error);
            return { success: false, error: error.message };
        }
    }

    startWindowMonitoring(checkInterval = 2000) {
        this.sessionInterval = setInterval(async () => {
            if (!this.sessionActive) return;

            try {
                const activeWin = await activeWindow();
                const currentTime = Date.now();
                const timeDiff = this.lastWindowCheck ? (currentTime - this.lastWindowCheck) / 1000 : 0;

                if (activeWin) {
                    const identity = this.getActiveWindowIdentity(activeWin);
                    const appName = identity.displayName;
                    this.currentActiveApp = appName;
                    const windowKey = `${identity.processName}:${identity.title}`;

                    if (this.shouldProtectProcess(identity.processName)) {
                        this.lastWindowCheck = currentTime;
                        return;
                    }

                    // Check if this is a selected, allowed, or blocked app
                    if (this.isAppSelected(identity) || this.isAppAllowed(identity)) {
                        this.focusedTime += timeDiff;
                        
                        // Send focus update to renderer
                        if (this.mainWindow) {
                            this.mainWindow.webContents.send('focus-update', {
                                app: appName,
                                status: 'focused',
                                duration: this.focusedTime
                            });
                        }
                    } else if (this.isAppBlocked(identity)) {
                        this.distractedTime += timeDiff;
                        this.trackBlockedAttempt(windowKey);
                        
                        // Track time spent on this distraction app
                        if (!this.distractionApps.has(appName)) {
                            this.distractionApps.set(appName, 0);
                        }
                        this.distractionApps.set(appName, this.distractionApps.get(appName) + timeDiff);
                        
                        // Show approval dialog for blocked app
                        await this.handleBlockedApp(appName);
                        await this.closeApp(identity);
                        
                        // Send distraction update to renderer
                        if (this.mainWindow) {
                            this.mainWindow.webContents.send('focus-update', {
                                app: appName,
                                status: 'blocked',
                                duration: this.distractedTime
                            });
                        }
                    } else {
                        // Unknown app - treat as distraction
                        this.distractedTime += timeDiff;
                        this.trackBlockedAttempt(windowKey);
                        
                        // Track time spent on this distraction app
                        if (!this.distractionApps.has(appName)) {
                            this.distractionApps.set(appName, 0);
                        }
                        this.distractionApps.set(appName, this.distractionApps.get(appName) + timeDiff);
                        
                        // Show approval dialog for unknown app
                        await this.handleUnknownApp(appName);
                        await this.closeApp(identity);
                        
                        // Send distraction update to renderer
                        if (this.mainWindow) {
                            this.mainWindow.webContents.send('focus-update', {
                                app: appName,
                                status: 'unknown',
                                duration: this.distractedTime
                            });
                        }
                    }
                }

                this.lastWindowCheck = currentTime;

                // Check if selected apps are running, open them if not
                await this.ensureSelectedAppsRunning();
                
                // Check if blocked apps are running, close them if found
                await this.ensureBlockedAppsClosed();
            } catch (error) {
                console.error('Error monitoring windows:', error);
            }
        }, checkInterval);
    }

    async ensureSelectedAppsRunning() {
        try {
            const runningProcesses = await this.getRunningProcesses();
            for (const appName of this.selectedApps) {
                const appRecord = this.findAppRecord(appName);
                const isRunning = runningProcesses.some(processInfo =>
                    this.recordMatchesProcess(appName, appRecord, processInfo)
                );

                if (!isRunning) {
                    console.log(`Opening selected app: ${appName}`);
                    await this.openApp(appName);
                    this.openedApps.add(appName);
                    // Small delay between opening apps
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        } catch (error) {
            console.error('Error ensuring selected apps are running:', error);
        }
    }

    async ensureBlockedAppsClosed() {
        try {
            const runningProcesses = await this.getRunningProcesses();
            for (const processInfo of runningProcesses) {
                if (this.shouldProtectProcess(processInfo.processName)) {
                    continue;
                }

                const identity = this.getProcessIdentity(processInfo);
                if (this.isAppBlocked(identity)) {
                    console.log(`Closing blocked app: ${identity.displayName}`);
                    await this.closeApp(identity);
                }
            }
        } catch (error) {
            console.error('Error ensuring blocked apps are closed:', error);
        }
    }

    isAppSelected(appIdentity) {
        return this.isAppInSet(appIdentity, this.selectedApps);
    }

    isAppAllowed(appIdentity) {
        return this.isAppInSet(appIdentity, this.allowedApps);
    }

    isAppBlocked(appIdentity) {
        return this.isAppInSet(appIdentity, this.blockedApps);
    }

    isAppInSet(appIdentity, appSet) {
        const identity = typeof appIdentity === 'string'
            ? { displayName: appIdentity, processName: appIdentity, title: '', path: '', commandLine: '' }
            : appIdentity;

        for (const appName of appSet) {
            const appRecord = this.findAppRecord(appName);
            if (this.recordMatchesIdentity(appName, appRecord, identity)) {
                return true;
            }
        }

        return false;
    }

    recordMatchesIdentity(appName, appRecord, identity) {
        const aliases = this.getAppAliases(appName, appRecord);
        const identityTokens = [
            identity.displayName,
            identity.processName,
            identity.title,
            identity.path,
            identity.commandLine
        ].filter(Boolean).map(value => this.normalizeAppName(value));

        return aliases.some(alias => {
            if (!alias) return false;
            return identityTokens.some(token =>
                token === alias ||
                token.includes(alias) ||
                alias.includes(token)
            );
        });
    }

    recordMatchesProcess(appName, appRecord, processInfo) {
        return this.recordMatchesIdentity(appName, appRecord, this.getProcessIdentity(processInfo));
    }

    getAppAliases(appName, appRecord = null) {
        const values = [
            appName,
            appRecord?.name,
            appRecord?.processName,
            appRecord?.executable ? path.basename(appRecord.executable, path.extname(appRecord.executable)) : '',
            appRecord?.executable ? path.basename(appRecord.executable) : '',
            appRecord?.appId,
            appRecord?.appUserModelId,
            appRecord?.packageName,
            ...(appRecord?.aliases || [])
        ];

        return [...new Set(values.filter(Boolean).map(value => this.normalizeAppName(value)))];
    }

    normalizeAppName(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/\.exe$/i, '')
            .replace(/[^\w\s!.-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    getActiveWindowIdentity(activeWin) {
        const owner = activeWin?.owner || {};
        return {
            displayName: owner.name || activeWin?.title || 'Unknown',
            processName: path.basename(owner.name || '', path.extname(owner.name || '')),
            title: activeWin?.title || '',
            path: owner.path || '',
            pid: owner.processId,
            commandLine: ''
        };
    }

    getProcessIdentity(processInfo) {
        return {
            displayName: processInfo.name || processInfo.processName || 'Unknown',
            processName: processInfo.processName || processInfo.name || '',
            title: processInfo.title || '',
            path: processInfo.path || '',
            commandLine: processInfo.commandLine || '',
            pid: processInfo.pid
        };
    }

    trackBlockedAttempt(windowKey) {
        const lastAttempt = this.blockedAttemptWindows.get(windowKey) || 0;
        const currentTime = Date.now();
        if (currentTime - lastAttempt < 5000) {
            return;
        }

        this.blockedAttemptWindows.set(windowKey, currentTime);
        this.blockedCount++;
    }

    async handleBlockedApp(appName) {
        const requestId = Date.now().toString();
        
        this.pendingApprovals.set(requestId, {
            appName: appName,
            type: 'blocked',
            timestamp: Date.now()
        });

        // Show approval dialog in renderer
        if (this.mainWindow) {
            this.mainWindow.webContents.send('app-approval-request', {
                requestId: requestId,
                appName: appName,
                type: 'blocked',
                message: `"${appName}" is a blocked application. Opening it may ruin your productivity. Do you want to proceed?`
            });
        }
    }

    async handleUnknownApp(appName) {
        const requestId = Date.now().toString();
        
        this.pendingApprovals.set(requestId, {
            appName: appName,
            type: 'unknown',
            timestamp: Date.now()
        });

        // Show approval dialog in renderer
        if (this.mainWindow) {
            this.mainWindow.webContents.send('app-approval-request', {
                requestId: requestId,
                appName: appName,
                type: 'unknown',
                message: `"${appName}" is not in your selected applications. Do you want to open it in the background?`
            });
        }
    }

    async handleAppApprovalResponse(requestId, approved) {
        const request = this.pendingApprovals.get(requestId);
        if (!request) {
            return { success: false, error: 'Request not found' };
        }

        this.pendingApprovals.delete(requestId);

        if (approved) {
            // User approved - allow the app temporarily for this session.
            this.allowedApps.add(request.appName);
            return { success: true, allowed: true };
        } else {
            // User denied - try to close the app
            await this.closeApp(request.appName);
            return { success: true, allowed: false };
        }
    }

    async bringSelectedAppsToForeground() {
        console.log('Bringing selected apps to foreground:', Array.from(this.selectedApps));
        
        // Try to open selected apps that aren't running
        for (const appName of this.selectedApps) {
            try {
                await this.openApp(appName);
                this.openedApps.add(appName);
                
                // Small delay between opening apps
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                console.warn(`Could not open app ${appName}:`, error.message);
            }
        }
    }

    pushMainWindowToBackground() {
        if (!this.mainWindow) return;

        try {
            this.mainWindow.blur();
            this.mainWindow.minimize();
        } catch (error) {
            console.warn('Could not push main window to background:', error.message);
        }
    }

    async closeApp(appIdentity) {
        const identity = typeof appIdentity === 'string'
            ? { displayName: appIdentity, processName: appIdentity }
            : appIdentity;
        const appName = identity.displayName || identity.processName;

        console.log(`Closing app: ${appName}`);
        
        try {
            if (process.platform === 'win32') {
                if (identity.pid) {
                    await execPromise(`taskkill /PID ${identity.pid} /F`);
                } else {
                    const processName = this.normalizeProcessImageName(identity.processName || appName);
                    await execPromise(`taskkill /IM "${processName}" /F`);
                }
            } else if (process.platform === 'darwin') {
                // macOS: Use osascript to quit the application
                await execPromise(`osascript -e 'quit app "${appName}"'`);
            } else if (process.platform === 'linux') {
                // Linux: Use pkill to kill the process
                await execPromise(`pkill -f "${appName}"`);
            }
            return { success: true };
        } catch (error) {
            console.warn(`Could not close app ${appName}:`, error.message);
            return { success: false, error: error.message };
        }
    }

    async openApp(appName) {
        console.log(`Opening app: ${appName}`);
        
        try {
            await this.refreshAppCatalog();
            const appInfo = this.findAppRecord(appName);

            if (appInfo && appInfo.launchPath) {
                await shell.openPath(appInfo.launchPath);
            } else if (appInfo && appInfo.executable && appInfo.launchArgs) {
                await execPromise(`start "" "${appInfo.executable}" ${appInfo.launchArgs}`);
            } else if (appInfo && appInfo.executable) {
                await shell.openPath(appInfo.executable);
            } else if (process.platform === 'win32' && appInfo?.appUserModelId) {
                await execPromise(`explorer.exe shell:AppsFolder\\${appInfo.appUserModelId}`);
            } else {
                // Fallback: try common methods
                if (process.platform === 'win32') {
                    // Try to start the application by name
                    await execPromise(`start "" "${appName}"`);
                } else if (process.platform === 'darwin') {
                    // Try to open the application on macOS
                    await execPromise(`open -a "${appName}"`);
                } else {
                    // Try to launch on Linux
                    await execPromise(`${appName}`);
                }
            }
            
            return { success: true };
        } catch (error) {
            console.error(`Error opening app ${appName}:`, error);
            return { success: false, error: error.message };
        }
    }

    // App management methods
    async addAppManually(appName, appType = 'User Added', category = 'selected') {
        try {
            if (category === 'selected') {
                this.selectedApps.add(appName);
            } else if (category === 'allowed') {
                this.allowedApps.add(appName);
            } else if (category === 'blocked') {
                this.blockedApps.add(appName);
            }

            await this.saveData();
            return { success: true, app: { name: appName, type: appType } };
        } catch (error) {
            console.error('Error adding manual app:', error);
            return { success: false, error: error.message };
        }
    }

    async removeApp(appName) {
        try {
            let removed = false;

            if (this.selectedApps.has(appName)) {
                this.selectedApps.delete(appName);
                removed = true;
            }
            if (this.allowedApps.has(appName)) {
                this.allowedApps.delete(appName);
                removed = true;
            }
            if (this.blockedApps.has(appName)) {
                this.blockedApps.delete(appName);
                removed = true;
            }

            if (removed) {
                await this.saveData();
                return { success: true };
            } else {
                return { success: false, error: 'App not found' };
            }
        } catch (error) {
            console.error('Error removing app:', error);
            return { success: false, error: error.message };
        }
    }

    async getInstalledApps() {
        try {
            // Use the AppScanner to get installed apps
            const AppScanner = require('./appScanner');
            const scanner = new AppScanner();
            const result = await scanner.scanForApps();
            
            if (result.success) {
                this.updateAppCatalog(result.apps);
                return { 
                    success: true, 
                    apps: result.apps.map(app => ({ 
                        name: app.name, 
                        type: app.type || 'Installed Application',
                        path: app.path || '',
                        executable: app.executable || '',
                        publisher: app.publisher || 'Unknown',
                        processName: app.processName || '',
                        appId: app.appId || '',
                        appUserModelId: app.appUserModelId || ''
                    }))
                };
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('Error getting installed apps:', error);
            return { success: false, error: error.message };
        }
    }

    getSessionStats() {
        return this.sessionStats;
    }

    async clearAllData() {
        try {
            this.selectedApps.clear();
            this.allowedApps.clear();
            this.blockedApps.clear();
            this.sessionStats = [];
            await this.saveData();
            return { success: true };
        } catch (error) {
            console.error('Error clearing data:', error);
            return { success: false, error: error.message };
        }
    }

    // Utility methods
    getSessionStatus() {
        return {
            active: this.sessionActive,
            session: this.currentSession
        };
    }

    updateAppCatalog(apps = []) {
        for (const appInfo of apps) {
            if (!appInfo?.name) continue;
            this.appCatalog.set(this.normalizeAppName(appInfo.name), appInfo);
            for (const alias of this.getAppAliases(appInfo.name, appInfo)) {
                this.appCatalog.set(alias, appInfo);
            }
        }
    }

    async refreshAppCatalog() {
        if (this.appCatalog.size > 0) return;

        try {
            const AppScanner = require('./appScanner');
            const scanner = new AppScanner();
            const result = await scanner.scanForApps();
            if (result.success) {
                this.updateAppCatalog(result.apps);
            }
        } catch (error) {
            console.warn('Could not refresh app catalog:', error.message);
        }
    }

    findAppRecord(appName) {
        const normalized = this.normalizeAppName(appName);
        if (this.appCatalog.has(normalized)) {
            return this.appCatalog.get(normalized);
        }

        for (const appInfo of this.appCatalog.values()) {
            if (this.recordMatchesIdentity(appName, appInfo, { displayName: appName, processName: appName })) {
                return appInfo;
            }
        }

        return null;
    }

    async getRunningProcesses() {
        if (process.platform === 'win32') {
            try {
                const script = [
                    'Get-CimInstance Win32_Process |',
                    'Select-Object ProcessId,Name,ExecutablePath,CommandLine |',
                    'ConvertTo-Json -Compress'
                ].join(' ');
                const { stdout } = await execPromise(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${script}"`, { maxBuffer: 1024 * 1024 * 10 });
                const parsed = JSON.parse(stdout.trim() || '[]');
                const processes = Array.isArray(parsed) ? parsed : [parsed];

                return processes.map(processInfo => ({
                    pid: processInfo.ProcessId,
                    name: processInfo.Name,
                    processName: path.basename(processInfo.Name || '', path.extname(processInfo.Name || '')),
                    path: processInfo.ExecutablePath || '',
                    commandLine: processInfo.CommandLine || ''
                }));
            } catch (error) {
                console.warn('CIM process scan failed:', error.message);
            }
        }

        try {
            const { stdout } = await execPromise(process.platform === 'win32' ? 'tasklist /fo csv /nh' : 'ps -A -o pid=,comm=');
            return stdout.split('\n').map(line => {
                if (process.platform === 'win32') {
                    const match = line.match(/"([^"]+\.exe)","?(\d+)/i);
                    return match ? {
                        pid: Number(match[2]),
                        name: match[1],
                        processName: path.basename(match[1], '.exe')
                    } : null;
                }

                const match = line.trim().match(/^(\d+)\s+(.+)$/);
                return match ? {
                    pid: Number(match[1]),
                    name: path.basename(match[2]),
                    processName: path.basename(match[2])
                } : null;
            }).filter(Boolean);
        } catch (error) {
            return [];
        }
    }

    shouldProtectProcess(processName) {
        const normalized = this.normalizeAppName(processName);
        return this.protectedProcessNames.has(normalized) ||
            normalized === this.normalizeAppName(path.basename(process.execPath || '', '.exe'));
    }

    normalizeProcessImageName(name) {
        const trimmed = String(name || '').trim();
        return trimmed.toLowerCase().endsWith('.exe') ? trimmed : `${trimmed}.exe`;
    }
}

module.exports = FocusManager;
