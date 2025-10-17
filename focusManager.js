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
        
        // Session tracking
        this.sessionStartTime = null;
        this.focusedTime = 0;
        this.distractedTime = 0;
        this.blockedCount = 0;
        this.lastWindowCheck = null;
        this.currentActiveApp = null;
        this.distractionApps = new Map(); // Track time spent on distraction apps
        this.openedApps = new Set(); // Track apps we've opened
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

            this.currentSession = {
                id: Date.now().toString(),
                name: settings.name,
                startTime: this.sessionStartTime,
                settings: settings,
                selectedApps: Array.from(this.selectedApps)
            };

            // Bring selected apps to foreground
            await this.bringSelectedAppsToForeground();

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
                    const appName = activeWin.owner.name;
                    this.currentActiveApp = appName;

                    // Check if this is a selected, allowed, or blocked app
                    if (this.isAppSelected(appName) || this.isAppAllowed(appName)) {
                        this.focusedTime += timeDiff;
                        
                        // Send focus update to renderer
                        if (this.mainWindow) {
                            this.mainWindow.webContents.send('focus-update', {
                                app: appName,
                                status: 'focused',
                                duration: this.focusedTime
                            });
                        }
                    } else if (this.isAppBlocked(appName)) {
                        this.distractedTime += timeDiff;
                        this.blockedCount++;
                        
                        // Track time spent on this distraction app
                        if (!this.distractionApps.has(appName)) {
                            this.distractionApps.set(appName, 0);
                        }
                        this.distractionApps.set(appName, this.distractionApps.get(appName) + timeDiff);
                        
                        // Show approval dialog for blocked app
                        await this.handleBlockedApp(appName);
                        
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
                        
                        // Track time spent on this distraction app
                        if (!this.distractionApps.has(appName)) {
                            this.distractionApps.set(appName, 0);
                        }
                        this.distractionApps.set(appName, this.distractionApps.get(appName) + timeDiff);
                        
                        // Show approval dialog for unknown app
                        await this.handleUnknownApp(appName);
                        
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
            // For simplicity, we'll try to open all selected apps periodically
            // In a real implementation, you'd check which apps are actually running
            for (const appName of this.selectedApps) {
                if (!this.openedApps.has(appName)) {
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
            const activeWin = await activeWindow();
            if (activeWin) {
                const currentApp = activeWin.owner.name;
                if (this.isAppBlocked(currentApp)) {
                    console.log(`Closing blocked app: ${currentApp}`);
                    await this.closeApp(currentApp);
                }
            }
        } catch (error) {
            console.error('Error ensuring blocked apps are closed:', error);
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
            // User approved - allow the app temporarily
            if (request.type === 'unknown') {
                // Add to allowed apps for this session
                this.allowedApps.add(request.appName);
            }
            // For blocked apps, we still allow but track the distraction
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

    async closeApp(appName) {
        console.log(`Closing app: ${appName}`);
        
        try {
            if (process.platform === 'win32') {
                // Windows: Use taskkill to close the application
                await execPromise(`taskkill /IM "${appName}.exe" /F`);
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
            // First try to find the actual executable using the AppScanner
            const AppScanner = require('./appScanner');
            const scanner = new AppScanner();
            await scanner.scanForApps();
            const detectedApps = scanner.getDetectedApps();
            
            // Find the app in detected apps
            const appInfo = detectedApps.find(app => 
                app.name.toLowerCase().includes(appName.toLowerCase()) || 
                appName.toLowerCase().includes(app.name.toLowerCase())
            );

            if (appInfo && appInfo.executable) {
                // Use the actual executable path
                await shell.openPath(appInfo.executable);
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