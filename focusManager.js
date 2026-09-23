const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
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
        
        // Enhanced session tracking
        this.sessionStartTime = null;
        this.focusedTime = 0;
        this.distractedTime = 0;
        this.blockedAttempts = 0;
        this.lastWindowCheck = null;
        this.currentActiveApp = null;
        this.distractionApps = new Map();
        this.openedApps = new Set();
        this.appUsageTime = new Map();
        this.lastAppSwitchTime = null;
        this.currentAppStartTime = null;
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
            this.blockedAttempts = 0;
            this.lastWindowCheck = Date.now();
            this.distractionApps.clear();
            this.openedApps.clear();
            this.appUsageTime.clear();
            this.lastAppSwitchTime = Date.now();
            this.currentAppStartTime = Date.now();

            this.currentSession = {
                id: Date.now().toString(),
                name: settings.name,
                startTime: this.sessionStartTime,
                settings: settings,
                selectedApps: Array.from(this.selectedApps),
                blockedApps: Array.from(this.blockedApps)
            };

            // Bring selected apps to foreground and ensure they're open
            await this.bringSelectedAppsToForeground();

            // Close any blocked apps that might be running
            await this.closeBlockedApps();

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
            
            // Calculate final time for current app
            this.trackAppUsageTime();

            // Calculate productivity score
            const productivity = totalDuration > 0 ? 
                Math.round((this.focusedTime / totalDuration) * 100) : 0;

            // Calculate distraction app times
            const distractionDetails = Array.from(this.distractionApps.entries()).map(([appName, time]) => ({
                appName,
                timeSpent: time,
                attempts: this.getAppAttempts(appName)
            }));

            const sessionSummary = {
                sessionId: this.currentSession.id,
                sessionName: this.currentSession.name,
                startTime: this.sessionStartTime,
                endTime: sessionEndTime,
                totalDuration: totalDuration,
                focusedTime: this.focusedTime,
                distractedTime: this.distractedTime,
                blockedAttempts: this.blockedAttempts,
                productivity: productivity,
                selectedApps: Array.from(this.selectedApps),
                blockedApps: Array.from(this.blockedApps),
                distractionDetails: distractionDetails,
                appUsageBreakdown: Array.from(this.appUsageTime.entries()).map(([appName, time]) => ({
                    appName,
                    timeSpent: time
                }))
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
                const activeApp = await this.getActiveApplication();
                const currentTime = Date.now();
                const timeDiff = this.lastWindowCheck ? (currentTime - this.lastWindowCheck) / 1000 : 0;

                if (activeApp) {
                    const appName = activeApp.name;
                    
                    // Track app usage time
                    this.trackAppUsageTime();
                    this.currentActiveApp = appName;
                    this.currentAppStartTime = currentTime;

                    // Check if this is a selected, allowed, or blocked app
                    if (this.isAppSelected(appName) || this.isAppAllowed(appName)) {
                        this.focusedTime += timeDiff;
                        
                        // Send focus update to renderer
                        if (this.mainWindow) {
                            this.mainWindow.webContents.send('focus-update', {
                                app: appName,
                                status: 'focused',
                                focusedTime: this.focusedTime,
                                distractedTime: this.distractedTime,
                                blockedAttempts: this.blockedAttempts
                            });
                        }
                    } else {
                        this.distractedTime += timeDiff;
                        this.blockedAttempts++;
                        
                        // Track time spent on this distraction app
                        if (!this.distractionApps.has(appName)) {
                            this.distractionApps.set(appName, 0);
                        }
                        this.distractionApps.set(appName, this.distractionApps.get(appName) + timeDiff);
                        
                        // Show approval dialog for blocked/unknown app
                        if (this.isAppBlocked(appName)) {
                            await this.handleBlockedApp(appName);
                        } else {
                            await this.handleUnknownApp(appName);
                        }
                        
                        // Send distraction update to renderer
                        if (this.mainWindow) {
                            this.mainWindow.webContents.send('focus-update', {
                                app: appName,
                                status: this.isAppBlocked(appName) ? 'blocked' : 'unknown',
                                focusedTime: this.focusedTime,
                                distractedTime: this.distractedTime,
                                blockedAttempts: this.blockedAttempts
                            });
                        }
                    }
                }

                this.lastWindowCheck = currentTime;

                // Ensure selected apps are running and blocked apps are closed
                await this.ensureSelectedAppsRunning();
                await this.closeBlockedApps();
                
            } catch (error) {
                console.error('Error monitoring windows:', error);
            }
        }, checkInterval);
    }

    async getActiveApplication() {
        try {
            if (process.platform === 'win32') {
                const { stdout } = await execPromise('powershell "Get-Process | Where-Object {$_.MainWindowTitle -ne \"\"} | Select-Object Name, MainWindowTitle | ConvertTo-Json"');
                const processes = JSON.parse(stdout);
                if (Array.isArray(processes) && processes.length > 0) {
                    return { name: processes[0].Name.replace('.exe', '') };
                }
            } else if (process.platform === 'darwin') {
                const { stdout } = await execPromise('osascript -e \'tell application "System Events" to get name of first application process whose frontmost is true\'');
                return { name: stdout.trim() };
            } else if (process.platform === 'linux') {
                const { stdout } = await execPromise('xprop -root _NET_ACTIVE_WINDOW | cut -d " " -f 5 | xargs -I {} xprop -id {} WM_CLASS | cut -d " " -f 3');
                return { name: stdout.replace(/"/g, '').trim() };
            }
        } catch (error) {
            console.error('Error getting active application:', error);
        }
        return null;
    }

    trackAppUsageTime() {
        if (this.currentActiveApp && this.currentAppStartTime) {
            const currentTime = Date.now();
            const timeDiff = (currentTime - this.currentAppStartTime) / 1000;
            
            if (!this.appUsageTime.has(this.currentActiveApp)) {
                this.appUsageTime.set(this.currentActiveApp, 0);
            }
            this.appUsageTime.set(this.currentActiveApp, this.appUsageTime.get(this.currentActiveApp) + timeDiff);
            
            this.currentAppStartTime = currentTime;
        }
    }

    getAppAttempts(appName) {
        // This would track individual app attempt counts - simplified for now
        return 1;
    }

    async ensureSelectedAppsRunning() {
        try {
            for (const appName of this.selectedApps) {
                if (!this.openedApps.has(appName)) {
                    console.log(`Opening selected app: ${appName}`);
                    const result = await this.openApp(appName);
                    if (result.success) {
                        this.openedApps.add(appName);
                        // Small delay between opening apps
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }
            }
        } catch (error) {
            console.error('Error ensuring selected apps are running:', error);
        }
    }

    async closeBlockedApps() {
        try {
            for (const appName of this.blockedApps) {
                console.log(`Checking and closing blocked app: ${appName}`);
                await this.closeApp(appName);
            }
        } catch (error) {
            console.error('Error closing blocked apps:', error);
        }
    }

    isAppSelected(appName) {
        return this.selectedApps.has(appName);
    }

    isAppAllowed(appName) {
        return this.allowedApps.has(appName);
    }

    isAppBlocked(appName) {
        return this.blockedApps.has(appName);
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
                message: `"${appName}" is not in your selected applications. Do you want to open it as a background app?`
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
            // User approved - allow the app temporarily
            if (request.type === 'unknown') {
                this.allowedApps.add(request.appName);
                await this.saveData();
            }
            return { success: true, allowed: true };
        } else {
            // User denied - try to close the app
            await this.closeApp(request.appName);
            return { success: true, allowed: false };
        }
    }

    async bringSelectedAppsToForeground() {
        console.log('Bringing selected apps to foreground:', Array.from(this.selectedApps));
        
        for (const appName of this.selectedApps) {
            try {
                await this.openApp(appName);
                this.openedApps.add(appName);
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                console.warn(`Could not open app ${appName}:`, error.message);
            }
        }
    }

    async closeApp(appName) {
        console.log(`Attempting to close app: ${appName}`);
        
        try {
            if (process.platform === 'win32') {
                await execPromise(`taskkill /IM "${appName}.exe" /F`).catch(() => {});
                await execPromise(`taskkill /IM "${appName}" /F`).catch(() => {});
                // Also try with common extensions
                await execPromise(`taskkill /IM "${appName}.exe" /F`).catch(() => {});
                await execPromise(`taskkill /IM "${appName}.com" /F`).catch(() => {});
                await execPromise(`taskkill /IM "${appName}.bat" /F`).catch(() => {});
            } else if (process.platform === 'darwin') {
                await execPromise(`pkill -f "${appName}"`).catch(() => {});
                await execPromise(`killall "${appName}"`).catch(() => {});
            } else if (process.platform === 'linux') {
                await execPromise(`pkill -f "${appName}"`).catch(() => {});
                await execPromise(`killall "${appName}"`).catch(() => {});
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
            // Try to find the app using system commands first
            if (process.platform === 'win32') {
                await execPromise(`start "" "${appName}"`).catch(() => {});
                // Try different ways to open the app
                await execPromise(`"${appName}"`).catch(() => {});
            } else if (process.platform === 'darwin') {
                await execPromise(`open -a "${appName}"`).catch(() => {});
                await execPromise(`open "${appName}"`).catch(() => {});
            } else {
                await execPromise(`${appName}`).catch(() => {});
                await execPromise(`./${appName}`).catch(() => {});
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
            const AppScanner = require('./appScanner');
            const scanner = new AppScanner();
            const result = await scanner.scanForApps();
            
            if (result.success) {
                return { 
                    success: true, 
                    apps: result.apps.map(app => ({ 
                        name: app.name, 
                        type: app.type || 'Installed Application',
                        path: app.path || '',
                        executable: app.executable || '',
                        publisher: app.publisher || 'Unknown'
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
}

module.exports = FocusManager;