const { app, BrowserWindow, dialog, shell, Notification } = require('electron');
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
        this.temporaryAllowedApps = new Set();
        this.moderateAttempts = new Set();

        // User Settings / Preferences
        this.settings = {
            checkInterval: 1500,
            focusMode: 'moderate', // 'aggressive' | 'moderate' | 'lenient'
            notifications: true,
            autoStart: false
        };

        // Launch cooldown map to prevent endless spawn loops
        this.launchCooldowns = new Map();
        this.launchFailureNotifications = new Set();
        this.isChecking = false;

        // Notification anti-loop tracking
        this.notificationCooldowns = new Map(); // key -> last timestamp
        this.lastGlobalNotificationTime = 0;

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

    alphaNumericOnly(str) {
        if (!str) return '';
        return str.toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    /**
     * Smart matcher that determines if an active window/process matches a configured app name
     */
    matchesApp(activeInfo, targetAppName) {
        if (!activeInfo || !targetAppName) return false;

        const targetNorm = this.normalizeName(targetAppName);
        if (!targetNorm) return false;

        const targetAlpha = this.alphaNumericOnly(targetNorm);

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

        const activeProcAlpha = this.alphaNumericOnly(activeProcName);
        const activePathName = this.normalizeName(path.basename(activePath));
        const activePathAlpha = this.alphaNumericOnly(activePathName);
        const titleHasName = (name) => {
            if (!name || name.length < 3) return false;
            const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(activeTitle);
        };

        // Process identity should be exact to avoid matching unrelated apps.
        if (activeProcName) {
            if (activeProcName === targetNorm) {
                return true;
            }
        }

        // Alphanumeric equality handles punctuation in configured names.
        if (targetAlpha && activeProcAlpha) {
            if (activeProcAlpha === targetAlpha) {
                return true;
            }
        }
        if (activePathName && activePathName === targetNorm) {
            return true;
        }
        if (targetAlpha && activePathAlpha && activePathAlpha === targetAlpha) {
            return true;
        }

        // 3. Known process aliases for target app
        const knownAliases = NativeWindows.getKnownProcessNames(targetAppName);
        for (const alias of knownAliases) {
            const aliasNorm = this.normalizeName(alias);
            const aliasAlpha = this.alphaNumericOnly(aliasNorm);
            const isGenericProcess = NativeWindows.isGenericProcessName &&
                NativeWindows.isGenericProcessName(aliasNorm);

            if (activeProcName && activeProcName === aliasNorm) {
                if (!isGenericProcess || titleHasName(targetNorm) || titleHasName(targetAlpha)) {
                    return true;
                }
            }
            if (aliasAlpha && activeProcAlpha && activeProcAlpha === aliasAlpha) {
                if (!isGenericProcess || titleHasName(targetNorm) || titleHasName(targetAlpha)) {
                    return true;
                }
            }
            if (activePathName && (activePathName === aliasNorm || activePathAlpha === aliasAlpha)) {
                if (!isGenericProcess || titleHasName(targetNorm) || titleHasName(targetAlpha)) {
                    return true;
                }
            }
        }

        // 4. Check AppScanner cached executable path for target app
        if (this.appScanner && this.appScanner.appPathCache) {
            const cached = this.appScanner.appPathCache.get(targetNorm) || this.appScanner.appPathCache.get(targetAppName.toLowerCase());
            if (cached) {
                const exeBase = this.normalizeName(path.basename(cached));
                const exeAlpha = this.alphaNumericOnly(exeBase);
                if (exeBase && activeProcName && activeProcName === exeBase) {
                    return true;
                }
                if (exeAlpha && activeProcAlpha && exeAlpha === activeProcAlpha) {
                    return true;
                }
            }
        }

        // 5. Window title matching
        if (activeTitle) {
            if (titleHasName(targetNorm) || (targetAlpha && titleHasName(targetAlpha))) {
                return true;
            }
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
                if (data.settings && typeof data.settings === 'object') {
                    this.settings = Object.assign(this.settings, data.settings);
                }
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
        this.settings = {
            checkInterval: 1500,
            focusMode: 'moderate',
            notifications: true,
            autoStart: false
        };
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
                sessionStats: this.sessionStats,
                settings: this.settings
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

    async saveSettings(newSettings) {
        if (!newSettings || typeof newSettings !== 'object') {
            return { success: false, error: 'Invalid settings' };
        }
        this.settings = Object.assign(this.settings, newSettings);
        await this.saveData();
        return { success: true, settings: this.settings };
    }

    getSettings() {
        return this.settings;
    }

    /**
     * Send system desktop notification and UI toast with strict anti-loop cooldowns
     */
    sendDesktopNotification(title, body, options = {}) {
        const now = Date.now();
        const appKey = (options.appKey || title || '').toLowerCase().trim();

        if (!options.force) {
            // 1. Global cooldown: Do not send any notifications more often than every 8 seconds
            if (now - this.lastGlobalNotificationTime < 8000) {
                return false;
            }

            // 2. Per-app / per-reason cooldown: Do not repeat notifications for the same reason/app within 45 seconds
            const lastAppTime = this.notificationCooldowns.get(appKey) || 0;
            if (now - lastAppTime < 45000) {
                return false;
            }
        }

        this.lastGlobalNotificationTime = now;
        if (appKey) {
            this.notificationCooldowns.set(appKey, now);
        }

        // 1. Native Electron Notification
        try {
            if (Notification.isSupported()) {
                const iconPath = path.join(__dirname, 'assets', 'icon.png');
                const notif = new Notification({
                    title: title || 'Locked-In Focus Session',
                    body: body || '',
                    icon: fsSync.existsSync(iconPath) ? iconPath : undefined,
                    silent: options.silent || false
                });
                notif.show();
            }
        } catch (e) {
            console.warn('Desktop notification error:', e.message);
        }

        // 2. Broadcast to Renderer for Toast
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('desktop-notification', {
                title,
                body,
                type: options.type || 'info'
            });
        }

        return true;
    }

    async startSession(settings = {}) {
        if (this.sessionActive) {
            return { success: false, error: 'Session is already active' };
        }

        if (this.selectedApps.size === 0) {
            return { success: false, error: 'Please select at least one application before starting the focus session' };
        }

        const hasFocusableApp = [...this.selectedApps, ...this.allowedApps]
            .some(appName => !this.isAppBlocked(appName));
        if (!hasFocusableApp) {
            return { success: false, error: 'All selected and allowed applications are blocked' };
        }

        try {
            // Merge session settings with stored preferences
            const mergedSettings = Object.assign({}, this.settings, settings);

            this.sessionActive = true;
            this.sessionStartTime = Date.now();
            this.focusedTime = 0;
            this.distractedTime = 0;
            this.blockedAttempts = 0;
            this.lastWindowCheck = Date.now();
            this.distractionApps.clear();
            this.appUsageTime.clear();
            this.launchCooldowns.clear();
            this.launchFailureNotifications.clear();
            this.temporaryAllowedApps.clear();
            this.moderateAttempts.clear();
            this.notificationCooldowns.clear();
            this.lastGlobalNotificationTime = 0;
            this.currentActiveApp = null;
            this.lastActiveAppName = null;

            if (!['aggressive', 'moderate', 'lenient'].includes(mergedSettings.focusMode)) {
                mergedSettings.focusMode = 'moderate';
            }

            this.currentSession = {
                id: Date.now().toString(),
                name: mergedSettings.name || 'Focus Session',
                startTime: this.sessionStartTime,
                settings: mergedSettings,
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
            const checkInterval = Math.max(500, parseInt(mergedSettings.checkInterval) || 1500);
            this.startMonitoringLoop(checkInterval);

            // 5. Notify user of session start
            if (mergedSettings.notifications !== false) {
                const selNames = Array.from(this.selectedApps).slice(0, 3).join(', ');
                this.sendDesktopNotification(
                    'Focus Session Started (Locked In)',
                    `Mode: ${mergedSettings.focusMode || 'Moderate'}. Locked into: ${selNames}`,
                    { force: true, type: 'success' }
                );
            }

            // 6. Notify renderer
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
            this.launchFailureNotifications.clear();
            this.temporaryAllowedApps.clear();
            this.moderateAttempts.clear();

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

            // Send session completion notification
            if (this.settings.notifications !== false) {
                this.sendDesktopNotification(
                    'Focus Session Complete!',
                    `Productivity Score: ${productivity}%. Focused: ${Math.floor(focusedTimeSec / 60)}m ${focusedTimeSec % 60}s`,
                    { force: true, type: 'success' }
                );
            }

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
            if (this.isChecking) return;

            this.isChecking = true;
            try {
                const now = Date.now();
                const deltaSeconds = this.lastWindowCheck ? (now - this.lastWindowCheck) / 1000 : intervalMs / 1000;
                this.lastWindowCheck = now;

                const mode = (this.currentSession && this.currentSession.settings && this.currentSession.settings.focusMode) || this.settings.focusMode || 'moderate';
                const notificationsEnabled = (this.currentSession && this.currentSession.settings && this.currentSession.settings.notifications !== undefined)
                    ? this.currentSession.settings.notifications
                    : this.settings.notifications !== false;

                // 1. Get running processes snapshot
                const runningProcs = await NativeWindows.getRunningProcesses();

                // 2. BLOCKED APPS BACKGROUND ENFORCEMENT
                if (this.blockedApps.size > 0) {
                    for (const blockedApp of this.blockedApps) {
                        const isRunning = await NativeWindows.isProcessRunning(blockedApp, runningProcs);
                        if (isRunning) {
                            if (mode === 'aggressive' || mode === 'moderate') {
                                console.log(`[Safe Lock] Terminating running blocked app: ${blockedApp}`);
                                const terminated = await NativeWindows.killProcess(blockedApp);

                                if (notificationsEnabled) {
                                    this.sendDesktopNotification(
                                        terminated ? 'Blocked App Terminated' : 'Blocked App Still Running',
                                        terminated
                                            ? `"${blockedApp}" was running in the background and has been closed.`
                                            : `"${blockedApp}" could not be closed. Focus enforcement will continue.`,
                                        { appKey: blockedApp, type: 'error' }
                                    );
                                }
                            }
                        }
                    }
                }

                // 3. SELECTED APPS AUTO-REOPEN ENFORCEMENT (bounded retry with backoff)
                const BASE_RETRY_MS = 10000;
                const MAX_RETRIES = 3;
                for (const selectedApp of this.selectedApps) {
                    const norm = this.normalizeName(selectedApp);
                    if (this.isAppBlocked(selectedApp)) {
                        this.launchCooldowns.delete(norm);
                        this.launchFailureNotifications.delete(norm);
                        continue;
                    }
                    const isRunning = await NativeWindows.isProcessRunning(selectedApp, runningProcs);

                    if (isRunning) {
                        this.launchCooldowns.delete(norm);
                        this.launchFailureNotifications.delete(norm);
                    } else {
                        const launchState = this.launchCooldowns.get(norm) || { lastLaunch: 0, attempts: 0 };
                        const cooldownMs = BASE_RETRY_MS * (2 ** Math.max(0, launchState.attempts - 1));
                        if (launchState.attempts < MAX_RETRIES && now - launchState.lastLaunch >= cooldownMs) {
                            console.log(`[Safe Lock] Selected app closed (${selectedApp}). Relaunching...`);
                            this.launchCooldowns.set(norm, { lastLaunch: now, attempts: launchState.attempts + 1 });
                            const launched = await this.openApp(selectedApp);
                            if (!launched) {
                                console.warn(`Could not relaunch selected app ${selectedApp}`);
                            }
                        } else if (
                            launchState.attempts >= MAX_RETRIES &&
                            now - launchState.lastLaunch >= cooldownMs &&
                            !this.launchFailureNotifications.has(norm)
                        ) {
                            this.launchFailureNotifications.add(norm);
                            console.warn(`Relaunch paused after ${MAX_RETRIES} attempts for selected app ${selectedApp}`);
                            if (notificationsEnabled) {
                                this.sendDesktopNotification(
                                    'Selected App Could Not Be Reopened',
                                    `"${selectedApp}" did not start after several attempts. Open it manually to resume automatic monitoring.`,
                                    { appKey: 'reopen_failed_' + norm, type: 'error' }
                                );
                            }
                        }
                    }
                }

                // 4. DETECT ACTIVE FOREGROUND WINDOW
                const activeApp = await this.getActiveApplication();
                const activeName = activeApp ? (activeApp.name || activeApp.title || '') : '';
                const isSelf = /electron|locked-in/i.test(activeName);

                const matchedSelected = this.findMatchingAppInSet(this.selectedApps, activeApp || activeName);
                const matchedAllowed = this.findMatchingAppInSet(this.allowedApps, activeApp || activeName);
                const matchedTemporaryAllowed = this.findMatchingAppInSet(this.temporaryAllowedApps, activeApp || activeName);
                const matchedBlocked = this.findMatchingAppInSet(this.blockedApps, activeApp || activeName);

                // Windows system shell processes that shouldn't trigger distraction
                const isSystemShell = /^(explorer|taskhostw|dwm|searchapp|shellexperiencehost|textinputhost|applicationframehost|systemsettings)$/i.test(activeName);
                const isNewDistraction = this.lastActiveAppName !== activeName;

                if (matchedBlocked) {
                    // USER SWITCHED TO EXPLICITLY BLOCKED APP
                    this.distractedTime += deltaSeconds;
                    const distractionName = matchedBlocked;
                    this.currentActiveApp = distractionName;

                    if (isNewDistraction) {
                        this.blockedAttempts++;
                    }

                    const distData = this.distractionApps.get(distractionName) || { timeSpent: 0, attempts: 0 };
                    distData.timeSpent += deltaSeconds;
                    if (isNewDistraction) {
                        distData.attempts += 1;
                    }
                    this.distractionApps.set(distractionName, distData);

                    console.log(`[Focus Enforcement] Blocked app active (${distractionName}) in mode: ${mode}`);

                    if (mode === 'aggressive' || mode === 'moderate') {
                        await NativeWindows.killProcess(matchedBlocked);
                        await this.bringSelectedAppsToForeground();
                    }

                    // Only send desktop notification on initial switch to prevent continuous spamming
                    if (notificationsEnabled && isNewDistraction) {
                        this.sendDesktopNotification(
                            'Blocked App Intercepted',
                            `"${distractionName}" is blocked during your focus session.`,
                            { appKey: 'blocked_' + distractionName, type: 'error' }
                        );
                    }

                    this.sendFocusUpdate(distractionName, 'blocked');

                } else if (matchedSelected || matchedAllowed || matchedTemporaryAllowed || isSelf) {
                    // USER IS FOCUSED ON SELECTED OR ALLOWED APP
                    this.focusedTime += deltaSeconds;
                    const displayName = isSelf
                        ? (Array.from(this.selectedApps)[0] || 'Focus App')
                        : (matchedSelected || matchedAllowed || matchedTemporaryAllowed || activeName);
                    this.currentActiveApp = displayName;

                    const currentUsage = this.appUsageTime.get(displayName) || 0;
                    this.appUsageTime.set(displayName, currentUsage + deltaSeconds);

                    this.sendFocusUpdate(displayName, 'focused');

                } else if (isSystemShell) {
                    // Shell taskbar navigation, ignore
                } else {
                    // USER SWITCHED TO UNAUTHORIZED APP (DISTRACTION)
                    const distractionName = activeName || 'Unauthorized Window';
                    this.currentActiveApp = distractionName;
                    const attemptKey = this.normalizeName(distractionName);
                    const previousAttempt = this.moderateAttempts.has(attemptKey);
                    const moderateRetry = mode === 'moderate' &&
                        isNewDistraction &&
                        previousAttempt;

                    if (moderateRetry) {
                        this.temporaryAllowedApps.add(distractionName);
                        this.moderateAttempts.delete(attemptKey);
                        this.focusedTime += deltaSeconds;
                        const currentUsage = this.appUsageTime.get(distractionName) || 0;
                        this.appUsageTime.set(distractionName, currentUsage + deltaSeconds);

                        if (notificationsEnabled) {
                            this.sendDesktopNotification(
                                'App Allowed Until Session Ends',
                                `"${distractionName}" is temporarily allowed for this focus session.`,
                                { appKey: 'moderate_allowed_' + attemptKey, type: 'info' }
                            );
                        }
                        this.sendFocusUpdate(distractionName, 'focused');
                    } else {
                        this.distractedTime += deltaSeconds;
                        if (isNewDistraction) {
                            this.blockedAttempts++;
                        }

                        const distData = this.distractionApps.get(distractionName) || { timeSpent: 0, attempts: 0 };
                        distData.timeSpent += deltaSeconds;
                        if (isNewDistraction) {
                            distData.attempts += 1;
                        }
                        this.distractionApps.set(distractionName, distData);

                        const firstSelected = Array.from(this.selectedApps)[0] || 'Selected Task';

                        if (mode === 'aggressive') {
                            // Aggressive: Immediately return to a selected or allowed app.
                            await this.bringSelectedAppsToForeground();
                            if (notificationsEnabled && isNewDistraction) {
                                this.sendDesktopNotification(
                                    'Focus Restored (Aggressive)',
                                    `Redirected from "${distractionName}" back to ${firstSelected}.`,
                                    { appKey: 'distraction_' + attemptKey, type: 'warning' }
                                );
                            }
                        } else if (mode === 'moderate') {
                            if (isNewDistraction) {
                                this.moderateAttempts.add(attemptKey);
                            }
                            if (notificationsEnabled && isNewDistraction) {
                                this.sendDesktopNotification(
                                    'Focus Alert (Moderate Mode)',
                                    `Click "${distractionName}" again to continue, or return to ${firstSelected}.`,
                                    { appKey: 'distraction_' + attemptKey, type: 'warning' }
                                );
                            }
                            await this.bringSelectedAppsToForeground();
                        } else if (mode === 'lenient') {
                            // Lenient: Track the app and send a reminder without blocking it.
                            if (notificationsEnabled && isNewDistraction) {
                                this.sendDesktopNotification(
                                    'Focus Check (Lenient Mode)',
                                    `Currently in "${distractionName}". Remember your focus goal: ${firstSelected}`,
                                    { appKey: 'distraction_' + attemptKey, type: 'info' }
                                );
                            }
                        }

                        this.sendFocusUpdate(distractionName, 'distracted');
                    }
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
     * Start the primary selected apps; allowed apps remain available on demand.
     */
    async initialLaunchApps() {
        const runningProcs = await NativeWindows.getRunningProcesses();

        for (const appName of this.selectedApps) {
            if (this.isAppBlocked(appName)) continue;
            try {
                const running = await NativeWindows.isProcessRunning(appName, runningProcs);
                if (running) {
                    await NativeWindows.activateApp(appName);
                } else {
                    this.launchCooldowns.set(this.normalizeName(appName), { lastLaunch: Date.now(), attempts: 1 });
                    await this.openApp(appName);
                }
            } catch (e) {
                console.warn(`Could not launch selected app ${appName}:`, e.message);
            }
        }
    }

    /**
     * Restores focus to the selected or allowed apps
     */
    async bringSelectedAppsToForeground() {
        // Activate the first available selected app
        for (const appName of this.selectedApps) {
            if (this.isAppBlocked(appName)) continue;
            try {
                const activated = await NativeWindows.activateApp(appName);
                if (activated) return true;
            } catch (e) {}
        }

        // Fallback to allowed app
        for (const appName of this.allowedApps) {
            if (this.isAppBlocked(appName)) continue;
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
            this.settings = {
                checkInterval: 1500,
                focusMode: 'moderate',
                notifications: true,
                autoStart: false
            };
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