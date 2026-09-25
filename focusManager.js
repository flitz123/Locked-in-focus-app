const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { exec, spawn } = require('child_process');
const util = require('util');
const NativeWindows = require('./src/nativeWindows');
const AppScanner = require('./appScanner');

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
        this.appScanner = new AppScanner();

        // Path to persistent data
        const userDataPath = app ? app.getPath('userData') : path.join(__dirname, 'data');
        this.dataPath = path.join(userDataPath, 'focus-app-data.json');
        this.fallbackDataPath = path.join(__dirname, 'data', 'appData.json');

        // Live session metrics
        this.sessionStartTime = null;
        this.focusedTime = 0;
        this.distractedTime = 0;
        this.blockedAttempts = 0;
        this.lastWindowCheck = null;
        this.currentActiveApp = null;
        this.distractionApps = new Map(); // appName -> { timeSpent: number, attempts: number }
        this.appUsageTime = new Map();     // appName -> number (seconds)
        this.lastActiveAppName = null;
    }

    setMainWindow(window) {
        this.mainWindow = window;
    }

    getAppName(appItem) {
        if (!appItem) return '';
        if (typeof appItem === 'string') return appItem;
        return appItem.name || '';
    }

    normalizeName(name) {
        if (!name) return '';
        return name.toLowerCase().replace(/\.exe$/i, '').trim();
    }

    findAppInSet(set, appName) {
        const target = this.normalizeName(appName);
        if (!target) return null;
        for (const item of set) {
            const name = this.getAppName(item);
            if (this.normalizeName(name) === target) {
                return item;
            }
        }
        return null;
    }

    isAppSelected(appName) {
        return !!this.findAppInSet(this.selectedApps, appName);
    }

    isAppAllowed(appName) {
        return !!this.findAppInSet(this.allowedApps, appName);
    }

    isAppBlocked(appName) {
        return !!this.findAppInSet(this.blockedApps, appName);
    }

    async loadData() {
        try {
            let data = null;
            if (fsSync.existsSync(this.dataPath)) {
                const content = await fs.readFile(this.dataPath, 'utf8');
                data = JSON.parse(content);
            } else if (fsSync.existsSync(this.fallbackDataPath)) {
                const content = await fs.readFile(this.fallbackDataPath, 'utf8');
                data = JSON.parse(content);
            }

            if (data) {
                this.selectedApps = new Set(this.parseAppList(data.selectedApps));
                this.allowedApps = new Set(this.parseAppList(data.allowedApps));
                this.blockedApps = new Set(this.parseAppList(data.blockedApps));
                this.sessionStats = Array.isArray(data.sessionStats) ? data.sessionStats : [];
            } else {
                this.initializeDefaultData();
            }

            console.log(`FocusManager data loaded: ${this.selectedApps.size} selected, ${this.allowedApps.size} allowed, ${this.blockedApps.size} blocked, ${this.sessionStats.length} history items`);
            return { success: true };
        } catch (error) {
            console.error('Error loading data, initializing fresh:', error);
            this.initializeDefaultData();
            await this.saveData();
            return { success: true };
        }
    }

    initializeDefaultData() {
        this.selectedApps = new Set(['Word', 'Excel', 'Visual Studio Code', 'Notepad']);
        this.allowedApps = new Set(['Calculator', 'OneNote']);
        this.blockedApps = new Set(['Chrome', 'Discord', 'Spotify', 'Steam']);
        this.sessionStats = [];
    }

    parseAppList(list) {
        if (!Array.isArray(list)) return [];
        return list.map(item => {
            if (typeof item === 'string') return item;
            return item.name || '';
        }).filter(Boolean);
    }

    async saveData() {
        try {
            const data = {
                selectedApps: Array.from(this.selectedApps),
                allowedApps: Array.from(this.allowedApps),
                blockedApps: Array.from(this.blockedApps),
                sessionStats: this.sessionStats
            };

            const dir = path.dirname(this.dataPath);
            if (!fsSync.existsSync(dir)) {
                fsSync.mkdirSync(dir, { recursive: true });
            }

            await fs.writeFile(this.dataPath, JSON.stringify(data, null, 2), 'utf8');
            return { success: true };
        } catch (error) {
            console.error('Error saving data:', error);
            return { success: false, error: error.message };
        }
    }

    async startSession(settings = {}) {
        if (this.sessionActive) {
            return { success: false, error: 'Session is already active' };
        }

        if (this.selectedApps.size === 0) {
            return { success: false, error: 'Please select at least one application before starting the focus session' };
        }

        try {
            this.sessionActive = true;
            this.sessionStartTime = Date.now();
            this.focusedTime = 0;
            this.distractedTime = 0;
            this.blockedAttempts = 0;
            this.lastWindowCheck = Date.now();
            this.distractionApps.clear();
            this.appUsageTime.clear();
            this.currentActiveApp = null;
            this.lastActiveAppName = null;

            this.currentSession = {
                id: Date.now().toString(),
                name: settings.name || 'Focus Session',
                startTime: this.sessionStartTime,
                settings: settings,
                selectedApps: Array.from(this.selectedApps),
                allowedApps: Array.from(this.allowedApps),
                blockedApps: Array.from(this.blockedApps)
            };

            // 1. Bring selected and allowed apps to foreground
            await this.bringSelectedAppsToForeground();

            // 2. Push Locked-In App window to background / minimize
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.minimize();
            }

            // 3. Immediately close any running blocked apps
            await this.closeBlockedApps();

            // 4. Start active window & process monitoring loop
            const checkInterval = Math.max(1000, parseInt(settings.checkInterval) || 1500);
            this.startMonitoringLoop(checkInterval);

            // 5. Notify renderer
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('session-update', {
                    active: true,
                    session: this.currentSession
                });
            }

            return {
                success: true,
                sessionId: this.currentSession.id,
                session: this.currentSession,
                message: 'Focus session started successfully'
            };
        } catch (error) {
            console.error('Error starting session:', error);
            this.sessionActive = false;
            return { success: false, error: error.message };
        }
    }

    async stopSession() {
        if (!this.sessionActive) {
            return { success: false, error: 'No active session to stop' };
        }

        try {
            this.sessionActive = false;
            if (this.sessionInterval) {
                clearInterval(this.sessionInterval);
                this.sessionInterval = null;
            }

            const sessionEndTime = Date.now();
            const totalDuration = Math.max(1, Math.round((sessionEndTime - this.sessionStartTime) / 1000));
            const focusedTimeSec = Math.round(this.focusedTime);
            const distractedTimeSec = Math.round(this.distractedTime);

            // Compute productivity percentage
            const totalTracked = focusedTimeSec + distractedTimeSec;
            const productivity = totalTracked > 0
                ? Math.min(100, Math.round((focusedTimeSec / totalTracked) * 100))
                : 100;

            // Distraction details breakdown
            const distractionDetails = Array.from(this.distractionApps.entries()).map(([appName, data]) => ({
                appName,
                timeSpent: Math.round(data.timeSpent || 0),
                attempts: data.attempts || 1
            })).sort((a, b) => b.timeSpent - a.timeSpent);

            // App usage breakdown
            const appUsageBreakdown = Array.from(this.appUsageTime.entries()).map(([appName, time]) => ({
                appName,
                timeSpent: Math.round(time || 0)
            })).sort((a, b) => b.timeSpent - a.timeSpent);

            const sessionSummary = {
                sessionId: this.currentSession ? this.currentSession.id : Date.now().toString(),
                sessionName: this.currentSession ? this.currentSession.name : 'Focus Session',
                startTime: this.sessionStartTime,
                endTime: sessionEndTime,
                totalDuration: totalDuration,
                focusedTime: focusedTimeSec,
                distractedTime: distractedTimeSec,
                blockedAttempts: this.blockedAttempts,
                productivity: productivity,
                selectedApps: Array.from(this.selectedApps),
                allowedApps: Array.from(this.allowedApps),
                blockedApps: Array.from(this.blockedApps),
                distractionDetails: distractionDetails,
                appUsageBreakdown: appUsageBreakdown
            };

            // Save to session history (latest first)
            this.sessionStats.unshift(sessionSummary);
            await this.saveData();

            // Restore the main window so the user sees the summary
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                if (this.mainWindow.isMinimized()) {
                    this.mainWindow.restore();
                }
                this.mainWindow.show();
                this.mainWindow.focus();

                this.mainWindow.webContents.send('session-update', { active: false, session: null });
                this.mainWindow.webContents.send('session-summary', sessionSummary);
            }

            this.currentSession = null;
            this.sessionStartTime = null;

            return {
                success: true,
                summary: sessionSummary,
                message: 'Session ended successfully'
            };
        } catch (error) {
            console.error('Error stopping session:', error);
            return { success: false, error: error.message };
        }
    }

    startMonitoringLoop(intervalMs = 1500) {
        if (this.sessionInterval) {
            clearInterval(this.sessionInterval);
        }

        this.sessionInterval = setInterval(async () => {
            if (!this.sessionActive) return;

            try {
                const now = Date.now();
                const deltaSeconds = this.lastWindowCheck ? (now - this.lastWindowCheck) / 1000 : intervalMs / 1000;
                this.lastWindowCheck = now;

                // 1. Detect current active application
                const activeApp = await this.getActiveApplication();
                const activeName = activeApp ? (activeApp.name || activeApp.title || 'Unknown') : 'Selected Application';

                const isSelf = /electron|locked-in/i.test(activeName);
                const isSelected = this.isAppSelected(activeName);
                const isAllowed = this.isAppAllowed(activeName);
                const isBlocked = this.isAppBlocked(activeName);

                if (isSelected || isAllowed || isSelf) {
                    // USER IS FOCUSED ON ALLOWED/SELECTED APP
                    this.focusedTime += deltaSeconds;
                    const displayName = isSelf ? (Array.from(this.selectedApps)[0] || 'Focus App') : activeName;
                    this.currentActiveApp = displayName;

                    // Track app usage time
                    const currentUsage = this.appUsageTime.get(displayName) || 0;
                    this.appUsageTime.set(displayName, currentUsage + deltaSeconds);

                    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                        this.mainWindow.webContents.send('focus-update', {
                            app: displayName,
                            status: 'focused',
                            focusedTime: Math.round(this.focusedTime),
                            distractedTime: Math.round(this.distractedTime),
                            blockedAttempts: this.blockedAttempts
                        });
                    }
                } else {
                    // USER SWITCHED TO BLOCKED OR UNAUTHORIZED APP
                    this.distractedTime += deltaSeconds;
                    this.currentActiveApp = activeName;

                    // Record attempt if changed app
                    if (this.lastActiveAppName !== activeName) {
                        this.blockedAttempts++;
                    }

                    // Track distraction time & attempts for this specific app
                    const distData = this.distractionApps.get(activeName) || { timeSpent: 0, attempts: 0 };
                    distData.timeSpent += deltaSeconds;
                    if (this.lastActiveAppName !== activeName) {
                        distData.attempts += 1;
                    }
                    this.distractionApps.set(activeName, distData);

                    // Aggressive Safe Browser Enforcement:
                    // If blocked or unauthorized, close it and bring selected app to front!
                    if (isBlocked) {
                        console.log(`[Aggressive Block] Terminating blocked app: ${activeName}`);
                        await NativeWindows.killProcess(activeName);
                        await this.bringSelectedAppsToForeground();
                    } else {
                        // Non-selected app: minimize it or bring selected app back to front
                        console.log(`[Focus Lock] User navigated to unauthorized app: ${activeName}`);
                        await this.bringSelectedAppsToForeground();
                    }

                    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                        this.mainWindow.webContents.send('focus-update', {
                            app: activeName,
                            status: isBlocked ? 'blocked' : 'distracted',
                            focusedTime: Math.round(this.focusedTime),
                            distractedTime: Math.round(this.distractedTime),
                            blockedAttempts: this.blockedAttempts
                        });
                    }
                }

                this.lastActiveAppName = activeName;

                // 2. Ensure all selected apps remain open
                await this.ensureSelectedAppsRunning();

                // 3. Continuously enforce closing of any blocked app processes
                await this.closeBlockedApps();

            } catch (err) {
                console.error('Error during monitoring tick:', err);
            }
        }, intervalMs);
    }

    async getActiveApplication() {
        try {
            const fg = await NativeWindows.getForegroundWindow();
            if (fg && fg.name) {
                return fg;
            }
        } catch (e) {}

        // Fallback: detect via running processes with window title
        if (process.platform === 'win32') {
            try {
                const { stdout } = await execPromise('powershell -NoProfile "Get-Process | Where-Object {$_.MainWindowTitle -ne \"\"} | Select-Object -First 1 ProcessName, MainWindowTitle | ConvertTo-Json"', { timeout: 2000 });
                if (stdout && stdout.trim()) {
                    const parsed = JSON.parse(stdout.trim());
                    return { name: parsed.ProcessName, title: parsed.MainWindowTitle };
                }
            } catch (e) {}
        }
        return null;
    }

    async bringSelectedAppsToForeground() {
        const appsToFocus = [...Array.from(this.selectedApps), ...Array.from(this.allowedApps)];
        for (const appName of appsToFocus) {
            try {
                const running = await NativeWindows.isProcessRunning(appName);
                if (running) {
                    await NativeWindows.activateApp(appName);
                } else {
                    await this.openApp(appName);
                }
            } catch (e) {
                console.warn(`Could not bring app ${appName} to foreground:`, e.message);
            }
        }
    }

    async ensureSelectedAppsRunning() {
        for (const appName of this.selectedApps) {
            try {
                const isRunning = await NativeWindows.isProcessRunning(appName);
                if (!isRunning) {
                    console.log(`[Auto-Recovery] Selected app "${appName}" was closed. Relaunching...`);
                    await this.openApp(appName);
                }
            } catch (e) {
                // Ignore process check error
            }
        }
    }

    async closeBlockedApps() {
        for (const appName of this.blockedApps) {
            try {
                const isRunning = await NativeWindows.isProcessRunning(appName);
                if (isRunning) {
                    console.log(`[Safe-Lock] Closing blocked app: ${appName}`);
                    await NativeWindows.killProcess(appName);
                }
            } catch (e) {}
        }
    }

    async openApp(appNameOrPath) {
        return await NativeWindows.launchApp(appNameOrPath);
    }

    async closeApp(appName) {
        return await NativeWindows.killProcess(appName);
    }

    // Management methods
    async addAppManually(appName, appType = 'User Added', category = 'selected') {
        try {
            const cleanName = appName.trim();
            if (!cleanName) return { success: false, error: 'App name cannot be empty' };

            // Remove from other categories first to avoid collision
            this.selectedApps.delete(cleanName);
            this.allowedApps.delete(cleanName);
            this.blockedApps.delete(cleanName);

            if (category === 'selected') {
                this.selectedApps.add(cleanName);
            } else if (category === 'allowed') {
                this.allowedApps.add(cleanName);
            } else if (category === 'blocked') {
                this.blockedApps.add(cleanName);
            }

            await this.saveData();
            return {
                success: true,
                app: { name: cleanName, type: appType, category }
            };
        } catch (error) {
            console.error('Error adding app manually:', error);
            return { success: false, error: error.message };
        }
    }

    async removeApp(appName) {
        try {
            const clean = appName.trim();
            let removed = false;

            if (this.selectedApps.has(clean)) {
                this.selectedApps.delete(clean);
                removed = true;
            }
            if (this.allowedApps.has(clean)) {
                this.allowedApps.delete(clean);
                removed = true;
            }
            if (this.blockedApps.has(clean)) {
                this.blockedApps.delete(clean);
                removed = true;
            }

            if (removed) {
                await this.saveData();
                return { success: true };
            }
            return { success: false, error: 'Application not found in any list' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async getInstalledApps() {
        return await this.appScanner.scanForApps();
    }

    getSessionStats() {
        return this.sessionStats;
    }

    getSessionStatus() {
        return {
            active: this.sessionActive,
            session: this.currentSession,
            focusedTime: Math.round(this.focusedTime),
            distractedTime: Math.round(this.distractedTime),
            blockedAttempts: this.blockedAttempts
        };
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
            return { success: false, error: error.message };
        }
    }

    async handleAppApprovalResponse(requestId, approved) {
        const req = this.pendingApprovals.get(requestId);
        if (!req) return { success: false, error: 'Approval request expired' };
        this.pendingApprovals.delete(requestId);

        if (approved) {
            this.allowedApps.add(req.appName);
            await this.saveData();
            return { success: true, allowed: true };
        } else {
            await this.closeApp(req.appName);
            return { success: true, allowed: false };
        }
    }
}

module.exports = FocusManager;