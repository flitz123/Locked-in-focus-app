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

        // Launch cooldown map to prevent endless spawn loops
        this.launchCooldowns = new Map();
        this.isChecking = false;

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

    /**
     * Smart matcher that determines if an active window/process matches a configured app name
     */
    matchesApp(activeInfo, targetAppName) {
        if (!activeInfo || !targetAppName) return false;

        const targetNorm = this.normalizeName(targetAppName);
        if (!targetNorm) return false;

        let activeProcName = '';
        let activeTitle = '';
        let activePath = '';

        if (typeof activeInfo === 'string') {
            activeProcName = this.normalizeName(activeInfo);
        } else {
            activeProcName = this.normalizeName(activeInfo.name || '');
            activeTitle = (activeInfo.title || '').toLowerCase();
            activePath = (activeInfo.path || '').toLowerCase();
        }

        // 1. Direct name equality / substring
        if (activeProcName && (activeProcName === targetNorm || activeProcName.includes(targetNorm) || targetNorm.includes(activeProcName))) {
            return true;
        }

        // 2. Known process aliases for target app
        const knownAliases = NativeWindows.getKnownProcessNames(targetAppName);
        for (const alias of knownAliases) {
            const aliasNorm = this.normalizeName(alias);
            if (activeProcName && (activeProcName === aliasNorm || activeProcName.includes(aliasNorm) || aliasNorm.includes(activeProcName))) {
                return true;
            }
        }

        // 3. Check AppScanner cached executable path for target app
        if (this.appScanner && this.appScanner.appPathCache) {
            const cached = this.appScanner.appPathCache.get(targetNorm) || this.appScanner.appPathCache.get(targetAppName.toLowerCase());
            if (cached) {
                const exeBase = this.normalizeName(path.basename(cached));
                if (exeBase && activeProcName && (activeProcName === exeBase || activeProcName.includes(exeBase) || exeBase.includes(activeProcName))) {
                    return true;
                }
            }
        }

        // 4. Window title matching
        if (activeTitle) {
            if (activeTitle.includes(targetNorm) || targetNorm.includes(activeTitle)) {
                return true;
            }
            for (const alias of knownAliases) {
                if (activeTitle.includes(alias.toLowerCase())) {
                    return true;
                }
            }
        }

        // 5. Active path matching
        if (activePath && activePath.includes(targetNorm)) {
            return true;
        }

        return false;
    }

    findMatchingAppInSet(set, activeInfo) {
        for (const item of set) {
            const appName = this.getAppName(item);
            if (this.matchesApp(activeInfo, appName)) {
                return appName;
            }
        }
        return null;
    }

    isAppSelected(activeInfo) {
        return !!this.findMatchingAppInSet(this.selectedApps, activeInfo);
    }

    isAppAllowed(activeInfo) {
        return !!this.findMatchingAppInSet(this.allowedApps, activeInfo);
    }

    isAppBlocked(activeInfo) {
        return !!this.findMatchingAppInSet(this.blockedApps, activeInfo);
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
        this.selectedApps = new Set();
        this.allowedApps = new Set();
        this.blockedApps = new Set();
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
            this.launchCooldowns.clear();
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

            // 1. Immediately terminate any running blocked apps
            await this.closeBlockedApps();

            // 2. Launch / activate selected and allowed apps
            await this.initialLaunchApps();

            // 3. Minimize focus app window so user is immediately in focus mode
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.minimize();
            }

            // 4. Start active monitoring loop
            const checkInterval = Math.max(1000, parseInt(settings.checkInterval) || 1200);
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

            this.launchCooldowns.clear();

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

    startMonitoringLoop(intervalMs = 1200) {
        if (this.sessionInterval) {
            clearInterval(this.sessionInterval);
        }

        this.sessionInterval = setInterval(async () => {
            if (!this.sessionActive) return;
            if (this.isChecking) return;

            this.isChecking = true;
            try {
                const now = Date.now();
                const deltaSeconds = this.lastWindowCheck ? (now - this.lastWindowCheck) / 1000 : intervalMs / 1000;
                this.lastWindowCheck = now;

                // 1. Get running processes snapshot
                const runningProcs = await NativeWindows.getRunningProcesses();

                // 2. AGGRESSIVE BLOCKED APPS ENFORCEMENT: Kill any blocked app processes running in background
                if (this.blockedApps.size > 0) {
                    for (const blockedApp of this.blockedApps) {
                        const isRunning = await NativeWindows.isProcessRunning(blockedApp, runningProcs);
                        if (isRunning) {
                            console.log(`[Safe Lock] Killing blocked background app: ${blockedApp}`);
                            await NativeWindows.killProcess(blockedApp);
                        }
                    }
                }

                // 3. SELECTED APPS AUTO-REOPEN ENFORCEMENT (with anti-loop cooldown guard)
                const COOLDOWN_MS = 8000; // 8 seconds cooldown to let OS start process
                for (const selectedApp of this.selectedApps) {
                    const norm = this.normalizeName(selectedApp);
                    const isRunning = await NativeWindows.isProcessRunning(selectedApp, runningProcs);

                    if (isRunning) {
                        // App is running fine, clear launch cooldown
                        this.launchCooldowns.delete(norm);
                    } else {
                        // App is closed! Check cooldown before reopening
                        const lastLaunch = this.launchCooldowns.get(norm) || 0;
                        if (now - lastLaunch > COOLDOWN_MS) {
                            console.log(`[Safe Lock] Selected app was closed (${selectedApp}). Reopening manually...`);
                            this.launchCooldowns.set(norm, now);
                            await this.openApp(selectedApp);
                        }
                    }
                }

                // 4. DETECT ACTIVE FOREGROUND WINDOW
                const activeApp = await this.getActiveApplication();
                const activeName = activeApp ? (activeApp.name || activeApp.title || '') : '';
                const isSelf = /electron|locked-in/i.test(activeName);

                const matchedSelected = this.findMatchingAppInSet(this.selectedApps, activeApp || activeName);
                const matchedAllowed = this.findMatchingAppInSet(this.allowedApps, activeApp || activeName);
                const matchedBlocked = this.findMatchingAppInSet(this.blockedApps, activeApp || activeName);

                // Windows system shell processes that shouldn't immediately yank focus while clicking taskbar
                const isSystemShell = /^(explorer|taskhostw|dwm|searchapp|shellexperiencehost|textinputhost|applicationframehost)$/i.test(activeName);

                if (matchedBlocked) {
                    // USER OPENED / SWITCHED TO A BLOCKED APP: AGGRESSIVE KILL & RESTORE FOCUS
                    this.distractedTime += deltaSeconds;
                    const distractionName = matchedBlocked;
                    this.currentActiveApp = distractionName;

                    if (this.lastActiveAppName !== distractionName) {
                        this.blockedAttempts++;
                    }

                    const distData = this.distractionApps.get(distractionName) || { timeSpent: 0, attempts: 0 };
                    distData.timeSpent += deltaSeconds;
                    if (this.lastActiveAppName !== distractionName) {
                        distData.attempts += 1;
                    }
                    this.distractionApps.set(distractionName, distData);

                    console.log(`[Aggressive Block] Terminating active blocked window: ${distractionName}`);
                    if (activeApp && activeApp.name) {
                        await NativeWindows.killProcess(activeApp.name);
                    }
                    await NativeWindows.killProcess(matchedBlocked);
                    await this.bringSelectedAppsToForeground();

                    this.sendFocusUpdate(distractionName, 'blocked');
                } else if (matchedSelected || matchedAllowed || isSelf) {
                    // USER IS FOCUSED ON SELECTED OR ALLOWED APP (CAN SWITCH FREELY VIA TASKBAR)
                    this.focusedTime += deltaSeconds;
                    const displayName = isSelf ? (Array.from(this.selectedApps)[0] || 'Focus App') : (matchedSelected || matchedAllowed || activeName);
                    this.currentActiveApp = displayName;

                    const currentUsage = this.appUsageTime.get(displayName) || 0;
                    this.appUsageTime.set(displayName, currentUsage + deltaSeconds);

                    this.sendFocusUpdate(displayName, 'focused');
                } else if (isSystemShell) {
                    // User is interacting with taskbar/shell to switch between apps
                } else {
                    // USER SWITCHED TO UNAUTHORIZED NON-ALLOWED APP: SAFE BROWSER LOCK-IN
                    this.distractedTime += deltaSeconds;
                    const distractionName = activeName || 'Unauthorized App';
                    this.currentActiveApp = distractionName;

                    if (this.lastActiveAppName !== distractionName) {
                        this.blockedAttempts++;
                    }

                    const distData = this.distractionApps.get(distractionName) || { timeSpent: 0, attempts: 0 };
                    distData.timeSpent += deltaSeconds;
                    if (this.lastActiveAppName !== distractionName) {
                        distData.attempts += 1;
                    }
                    this.distractionApps.set(distractionName, distData);

                    console.log(`[Safe Lock] Restoring focus from unauthorized app: ${activeName}`);
                    await this.bringSelectedAppsToForeground();

                    this.sendFocusUpdate(distractionName, 'distracted');
                }

                this.lastActiveAppName = activeName;

            } catch (err) {
                console.error('Error during monitoring tick:', err);
            } finally {
                this.isChecking = false;
            }
        }, intervalMs);
    }

    sendFocusUpdate(appName, status) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('focus-update', {
                app: appName,
                status: status,
                focusedTime: Math.round(this.focusedTime),
                distractedTime: Math.round(this.distractedTime),
                blockedAttempts: this.blockedAttempts
            });
        }
    }

    async getActiveApplication() {
        try {
            const fg = await NativeWindows.getForegroundWindow();
            if (fg && (fg.name || fg.title)) {
                return fg;
            }
        } catch (e) {}

        return null;
    }

    /**
     * Initial launch at session start: Launches or activates selected & allowed apps
     */
    async initialLaunchApps() {
        const runningProcs = await NativeWindows.getRunningProcesses();

        // 1. Launch / activate selected apps
        for (const appName of this.selectedApps) {
            try {
                const running = await NativeWindows.isProcessRunning(appName, runningProcs);
                if (running) {
                    await NativeWindows.activateApp(appName);
                } else {
                    this.launchCooldowns.set(this.normalizeName(appName), Date.now());
                    await this.openApp(appName);
                }
            } catch (e) {
                console.warn(`Could not launch selected app ${appName}:`, e.message);
            }
        }

        // 2. Launch / activate allowed apps
        for (const appName of this.allowedApps) {
            try {
                const running = await NativeWindows.isProcessRunning(appName, runningProcs);
                if (running) {
                    await NativeWindows.activateApp(appName);
                }
            } catch (e) {
                console.warn(`Could not activate allowed app ${appName}:`, e.message);
            }
        }
    }

    /**
     * Restores focus to the selected or allowed apps
     */
    async bringSelectedAppsToForeground() {
        // Activate the first available selected app
        for (const appName of this.selectedApps) {
            try {
                const activated = await NativeWindows.activateApp(appName);
                if (activated) return true;
            } catch (e) {}
        }

        // Fallback to allowed app
        for (const appName of this.allowedApps) {
            try {
                const activated = await NativeWindows.activateApp(appName);
                if (activated) return true;
            } catch (e) {}
        }

        return false;
    }

    async closeBlockedApps() {
        if (this.blockedApps.size === 0) return;
        for (const appName of this.blockedApps) {
            try {
                await NativeWindows.killProcess(appName);
            } catch (e) {}
        }
    }

    async openApp(appNameOrPath) {
        if (!appNameOrPath) return false;
        const norm = this.normalizeName(appNameOrPath);

        if (this.appScanner) {
            if (this.appScanner.appPathCache) {
                const cached = this.appScanner.appPathCache.get(norm) ||
                               this.appScanner.appPathCache.get(appNameOrPath.toLowerCase());
                if (cached && fsSync.existsSync(cached)) {
                    return await NativeWindows.launchApp(cached);
                }
            }

            if (Array.isArray(this.appScanner.detectedApps)) {
                const found = this.appScanner.detectedApps.find(a => 
                    this.normalizeName(a.name) === norm ||
                    a.name.toLowerCase() === appNameOrPath.toLowerCase()
                );
                if (found && (found.executable || found.path)) {
                    const target = found.executable || found.path;
                    if (fsSync.existsSync(target)) {
                        return await NativeWindows.launchApp(target);
                    }
                }
            }
        }

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