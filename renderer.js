const { ipcRenderer } = require('electron');

class FocusAppRenderer {
    constructor() {
        this.currentSession = null;
        this.sessionActive = false;
        this.selectedApps = new Set();
        this.allowedApps = new Set();
        this.blockedApps = new Set();
        this.detectedApps = [];
        this.sessionStats = [];
        this.activeCategoryFilter = 'all';
        this.activePackageTab = 'all';
        this.selectedUploadFiles = [];

        this.currentFocusData = {
            currentApp: 'None',
            status: 'Inactive',
            focusedTime: 0,
            distractedTime: 0,
            blockedCount: 0
        };

        this.initializeEventListeners();
        this.setupIpcListeners();
        this.loadInitialData();
    }

    initializeEventListeners() {
        // Navigation items
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const btn = e.target.closest('.nav-item');
                if (btn) this.handleNavigation(btn.id);
            });
        });

        // Dashboard quick actions
        const quickScanBtn = document.getElementById('dashQuickScanBtn');
        if (quickScanBtn) {
            quickScanBtn.addEventListener('click', () => {
                this.handleNavigation('nav-detection');
                this.scanApps();
            });
        }

        // Focus Session Controls
        const startBtn = document.getElementById('startSessionBtn');
        if (startBtn) startBtn.addEventListener('click', () => this.startSession());

        const stopBtn = document.getElementById('stopSessionBtn');
        if (stopBtn) stopBtn.addEventListener('click', () => this.stopSession());

        // App Detection Controls
        const scanBtn = document.getElementById('scanAppsBtn');
        if (scanBtn) scanBtn.addEventListener('click', () => this.scanApps());

        const searchAppsInput = document.getElementById('searchApps');
        if (searchAppsInput) {
            searchAppsInput.addEventListener('input', (e) => this.filterDetectedApps(e.target.value));
        }

        // Category Filter Pills
        document.querySelectorAll('.filter-pill').forEach(pill => {
            pill.addEventListener('click', (e) => {
                document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                this.activeCategoryFilter = pill.dataset.category;
                const searchVal = document.getElementById('searchApps') ? document.getElementById('searchApps').value : '';
                this.filterDetectedApps(searchVal);
            });
        });

        // Modals & Triggers
        const addManualBtn = document.getElementById('addManualAppBtn');
        if (addManualBtn) addManualBtn.addEventListener('click', () => this.showManualAppModal());

        const uploadAppBtn = document.getElementById('uploadAppBtn');
        if (uploadAppBtn) uploadAppBtn.addEventListener('click', () => this.showFileUploadModal());

        const packageManagerBtn = document.getElementById('packageManagerBtn');
        if (packageManagerBtn) packageManagerBtn.addEventListener('click', () => this.showPackageManagerModal());

        // Settings & History Actions
        const saveSettingsBtn = document.getElementById('saveSettingsBtn');
        if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', () => this.saveSettings());

        const clearDataBtn = document.getElementById('clearDataBtn');
        if (clearDataBtn) clearDataBtn.addEventListener('click', () => this.clearAllData());

        const exportDataBtn = document.getElementById('exportDataBtn');
        if (exportDataBtn) exportDataBtn.addEventListener('click', () => this.exportData());

        // Modal Specific Controls
        this.initializeModalEvents();
    }

    initializeModalEvents() {
        // Close buttons on all modals
        document.querySelectorAll('.modal .close-btn, .modal .close').forEach(closeBtn => {
            closeBtn.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal');
                if (modal) modal.style.display = 'none';
            });
        });

        // Click outside modal dialog to dismiss
        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                e.target.style.display = 'none';
            }
        });

        // Session Summary Modal Done button
        const dismissSummaryBtn = document.getElementById('dismissSummaryBtn');
        if (dismissSummaryBtn) {
            dismissSummaryBtn.addEventListener('click', () => {
                document.getElementById('sessionSummaryModal').style.display = 'none';
            });
        }

        // Manual App Modal buttons
        const saveManualAppBtn = document.getElementById('saveManualAppBtn');
        if (saveManualAppBtn) saveManualAppBtn.addEventListener('click', () => this.addManualApp());

        const cancelManualAppBtn = document.getElementById('cancelManualAppBtn');
        if (cancelManualAppBtn) {
            cancelManualAppBtn.addEventListener('click', () => {
                document.getElementById('manualAppModal').style.display = 'none';
            });
        }

        // Package Manager
        const browseSystemBtn = document.getElementById('browseSystemBtn');
        if (browseSystemBtn) browseSystemBtn.addEventListener('click', () => this.browseSystemApps());

        const searchPackagesInput = document.getElementById('searchPackages');
        if (searchPackagesInput) {
            searchPackagesInput.addEventListener('input', (e) => this.filterPackageList(e.target.value));
        }

        const closePackageBtnFooter = document.getElementById('closePackageBtnFooter');
        if (closePackageBtnFooter) {
            closePackageBtnFooter.addEventListener('click', () => {
                document.getElementById('packageManagerModal').style.display = 'none';
            });
        }

        document.querySelectorAll('.pkg-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.pkg-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this.activePackageTab = tab.dataset.tab;
                const searchVal = document.getElementById('searchPackages') ? document.getElementById('searchPackages').value : '';
                this.filterPackageList(searchVal);
            });
        });

        // File Upload Controls
        const browseFileBtn = document.getElementById('browseFileBtn');
        if (browseFileBtn) {
            browseFileBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openNativeFileDialog();
            });
        }

        const uploadArea = document.getElementById('uploadArea');
        if (uploadArea) {
            uploadArea.addEventListener('click', () => this.openNativeFileDialog());
            uploadArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                uploadArea.style.borderColor = 'var(--primary)';
            });
            uploadArea.addEventListener('dragleave', () => {
                uploadArea.style.borderColor = 'var(--border-color)';
            });
            uploadArea.addEventListener('drop', (e) => {
                e.preventDefault();
                uploadArea.style.borderColor = 'var(--border-color)';
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    this.handleDroppedFiles(e.dataTransfer.files);
                }
            });
        }

        const fileInput = document.getElementById('fileInput');
        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                if (e.target.files) this.handleDroppedFiles(e.target.files);
            });
        }

        const processFilesBtn = document.getElementById('processFilesBtn');
        if (processFilesBtn) processFilesBtn.addEventListener('click', () => this.processUploadedFiles());

        const cancelUploadBtn = document.getElementById('cancelUploadBtn');
        if (cancelUploadBtn) {
            cancelUploadBtn.addEventListener('click', () => {
                document.getElementById('fileUploadModal').style.display = 'none';
            });
        }

        // App Access Request Approval buttons
        const approveAppBtn = document.getElementById('approveAppBtn');
        if (approveAppBtn) approveAppBtn.addEventListener('click', () => this.handleAppApproval(true));

        const denyAppBtn = document.getElementById('denyAppBtn');
        if (denyAppBtn) denyAppBtn.addEventListener('click', () => this.handleAppApproval(false));
    }

    setupIpcListeners() {
        ipcRenderer.on('session-update', (event, data) => {
            this.handleSessionUpdate(data);
        });

        ipcRenderer.on('focus-update', (event, data) => {
            this.updateFocusDisplay(data);
        });

        ipcRenderer.on('session-summary', (event, summary) => {
            this.showSessionSummary(summary);
        });

        ipcRenderer.on('app-approval-request', (event, data) => {
            this.showAppApprovalModal(data);
        });
    }

    async loadInitialData() {
        try {
            // Load app lists
            const appLists = await ipcRenderer.invoke('get-app-lists');
            this.selectedApps = new Set(appLists.selectedApps || []);
            this.allowedApps = new Set(appLists.allowedApps || []);
            this.blockedApps = new Set(appLists.blockedApps || []);

            // Load session history stats
            this.sessionStats = (await ipcRenderer.invoke('get-session-stats')) || [];

            // Load session status
            const status = await ipcRenderer.invoke('get-session-status');
            this.sessionActive = !!status.active;
            this.currentSession = status.session || null;

            if (status.active) {
                this.currentFocusData.focusedTime = status.focusedTime || 0;
                this.currentFocusData.distractedTime = status.distractedTime || 0;
                this.currentFocusData.blockedCount = status.blockedAttempts || 0;
            }

            this.updateUI();

            // Perform initial app scan in background for instant availability
            setTimeout(() => {
                this.scanApps(true);
            }, 500);

        } catch (error) {
            console.error('Error loading initial data:', error);
        }
    }

    handleNavigation(navId) {
        document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
        const activeNav = document.getElementById(navId);
        if (activeNav) activeNav.classList.add('active');

        document.querySelectorAll('.content-section').forEach(sec => sec.classList.remove('active'));

        switch (navId) {
            case 'nav-dashboard':
                document.getElementById('dashboardSection').classList.add('active');
                break;
            case 'nav-apps':
                document.getElementById('appsSection').classList.add('active');
                break;
            case 'nav-detection':
                document.getElementById('detectionSection').classList.add('active');
                if (this.detectedApps.length === 0) {
                    this.scanApps();
                }
                break;
            case 'nav-sessions':
                document.getElementById('sessionsSection').classList.add('active');
                this.loadSessionHistory();
                break;
            case 'nav-settings':
                document.getElementById('settingsSection').classList.add('active');
                break;
        }
    }

    // ==========================================
    // SESSION MANAGEMENT
    // ==========================================

    async startSession() {
        if (this.selectedApps.size === 0) {
            this.showNotification('Please add at least one selected app before starting the focus session.', 'warning');
            this.handleNavigation('nav-apps');
            return;
        }

        const sessionNameInput = document.getElementById('sessionName');
        const sessionName = (sessionNameInput && sessionNameInput.value.trim()) || 'Deep Focus Session';
        const checkInterval = parseInt(document.getElementById('checkInterval') ? document.getElementById('checkInterval').value : 1500) || 1500;

        const settings = {
            name: sessionName,
            checkInterval: checkInterval
        };

        try {
            this.showNotification('Starting focus session and bringing selected apps to front...', 'info');
            const result = await ipcRenderer.invoke('start-session', settings);

            if (result.success) {
                this.sessionActive = true;
                this.currentSession = result.session;
                this.currentFocusData = {
                    currentApp: Array.from(this.selectedApps)[0] || 'Selected App',
                    status: 'Focused',
                    focusedTime: 0,
                    distractedTime: 0,
                    blockedCount: 0
                };
                this.showNotification('Focus Session Started! You are locked into selected apps.', 'success');
                this.updateUI();
            } else {
                this.showNotification(`Could not start session: ${result.error}`, 'error');
            }
        } catch (error) {
            this.showNotification(`Error starting session: ${error.message}`, 'error');
        }
    }

    async stopSession() {
        try {
            this.showNotification('Ending focus session and preparing summary brief...', 'info');
            const result = await ipcRenderer.invoke('stop-session');

            if (result.success) {
                this.sessionActive = false;
                this.currentSession = null;
                this.showNotification('Session ended. Summary brief ready!', 'success');
                this.updateUI();

                if (result.summary) {
                    this.showSessionSummary(result.summary);
                }
                // Refresh session stats
                this.sessionStats = (await ipcRenderer.invoke('get-session-stats')) || [];
                this.loadSessionHistory();
            } else {
                this.showNotification(`Failed to end session: ${result.error}`, 'error');
            }
        } catch (error) {
            this.showNotification(`Error stopping session: ${error.message}`, 'error');
        }
    }

    handleSessionUpdate(data) {
        this.sessionActive = !!data.active;
        this.currentSession = data.session || null;
        this.updateUI();
    }

    updateFocusDisplay(data) {
        if (!this.sessionActive) return;

        this.currentFocusData = {
            currentApp: data.app || 'None',
            status: data.status || 'Active',
            focusedTime: data.focusedTime || 0,
            distractedTime: data.distractedTime || 0,
            blockedCount: data.blockedAttempts || 0
        };

        const curAppEl = document.getElementById('currentApp');
        if (curAppEl) curAppEl.textContent = this.currentFocusData.currentApp;

        const statusEl = document.getElementById('focusStatus');
        if (statusEl) {
            statusEl.textContent = this.formatStatus(this.currentFocusData.status);
            statusEl.className = 'value ' + (data.status === 'focused' ? 'text-success' : 'text-danger');
        }

        const focTimeEl = document.getElementById('focusedTime');
        if (focTimeEl) focTimeEl.textContent = this.formatTime(this.currentFocusData.focusedTime);

        const distTimeEl = document.getElementById('distractedTime');
        if (distTimeEl) distTimeEl.textContent = this.formatTime(this.currentFocusData.distractedTime);

        const blkCountEl = document.getElementById('blockedCount');
        if (blkCountEl) blkCountEl.textContent = this.currentFocusData.blockedCount;
    }

    // ==========================================
    // SESSION SUMMARY BRIEF
    // ==========================================

    showSessionSummary(summary) {
        if (!summary) return;

        const titleEl = document.getElementById('summaryModalTitle');
        if (titleEl) titleEl.textContent = summary.sessionName || 'Focus Session Summary';

        const subtitleEl = document.getElementById('summaryModalSubtitle');
        if (subtitleEl) {
            const startStr = summary.startTime ? new Date(summary.startTime).toLocaleTimeString() : '';
            const endStr = summary.endTime ? new Date(summary.endTime).toLocaleTimeString() : '';
            const dateStr = summary.startTime ? new Date(summary.startTime).toLocaleDateString() : '';
            subtitleEl.textContent = `${dateStr} • ${startStr} - ${endStr}`;
        }

        const content = document.getElementById('sessionSummaryContent');
        if (!content) return;

        const focusedTime = summary.focusedTime || 0;
        const distractedTime = summary.distractedTime || 0;
        const totalDuration = summary.totalDuration || (focusedTime + distractedTime);
        const blockedAttempts = summary.blockedAttempts || 0;
        const productivity = summary.productivity !== undefined ? summary.productivity : 
            (totalDuration > 0 ? Math.round((focusedTime / totalDuration) * 100) : 100);

        const distractionDetails = summary.distractionDetails || [];
        const appUsageBreakdown = summary.appUsageBreakdown || [];

        content.innerHTML = `
            <!-- Top Metric Cards -->
            <div class="summary-overview-grid">
                <div class="summary-metric-card">
                    <div class="metric-val text-info">${this.formatTime(totalDuration)}</div>
                    <div class="metric-lbl">Total Session Duration</div>
                </div>
                <div class="summary-metric-card">
                    <div class="metric-val text-success">${this.formatTime(focusedTime)}</div>
                    <div class="metric-lbl">Time on Selected Apps</div>
                </div>
                <div class="summary-metric-card">
                    <div class="metric-val text-danger">${this.formatTime(distractedTime)}</div>
                    <div class="metric-lbl">Time Spent Away / Blocked</div>
                </div>
                <div class="summary-metric-card">
                    <div class="metric-val text-warning">${productivity}%</div>
                    <div class="metric-lbl">Productivity Score</div>
                </div>
            </div>

            <!-- Distraction & Unauthorized Access Attempts Breakdown -->
            <div class="summary-section">
                <h4><i class="fas fa-shield-virus text-danger"></i> Blocked & Non-Selected App Attempts (${blockedAttempts} total attempts)</h4>
                ${distractionDetails.length > 0 ? `
                    <table class="summary-table">
                        <thead>
                            <tr>
                                <th>Application Name</th>
                                <th>Attempts Blocked</th>
                                <th>Time Spent Away</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${distractionDetails.map(d => `
                                <tr>
                                    <td><strong>${d.appName}</strong></td>
                                    <td><span class="badge-danger app-count">${d.attempts} attempts</span></td>
                                    <td class="text-danger">${this.formatTime(d.timeSpent)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                ` : `
                    <div class="no-apps text-success" style="border-color: rgba(16, 185, 129, 0.3);">
                        <i class="fas fa-check-circle"></i> Zero distractions! You stayed 100% focused on your selected apps without opening blocked apps.
                    </div>
                `}
            </div>

            <!-- App Usage Breakdown -->
            <div class="summary-section">
                <h4><i class="fas fa-chart-bar text-primary"></i> Application Focus Breakdown</h4>
                ${appUsageBreakdown.length > 0 ? `
                    <table class="summary-table">
                        <thead>
                            <tr>
                                <th>Focused Application</th>
                                <th>Active Duration</th>
                                <th>Share of Focus</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${appUsageBreakdown.map(u => {
                                const share = focusedTime > 0 ? Math.round((u.timeSpent / focusedTime) * 100) : 0;
                                return `
                                    <tr>
                                        <td><strong>${u.appName}</strong></td>
                                        <td class="text-success">${this.formatTime(u.timeSpent)}</td>
                                        <td>${share}%</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                ` : `
                    <div class="no-apps">No detailed app breakdown available</div>
                `}
            </div>
        `;

        document.getElementById('sessionSummaryModal').style.display = 'flex';
    }

    // ==========================================
    // APP SCANNING & DISCOVERY
    // ==========================================

    async scanApps(silent = false) {
        try {
            if (!silent) this.showNotification('Performing deep scan of PC (Installed, Office 365, PWAs, Registry)...', 'info');

            const result = await ipcRenderer.invoke('scan-apps');
            if (result.success && Array.isArray(result.apps)) {
                this.detectedApps = result.apps;
                if (!silent) this.showNotification(`Deep scan complete: Discovered ${result.apps.length} applications!`, 'success');
                this.filterDetectedApps(document.getElementById('searchApps') ? document.getElementById('searchApps').value : '');
            } else {
                if (!silent) this.showNotification(`Scan error: ${result.error}`, 'error');
            }
        } catch (error) {
            if (!silent) this.showNotification(`Error during scan: ${error.message}`, 'error');
        }
    }

    filterDetectedApps(searchQuery = '') {
        const query = (searchQuery || '').toLowerCase().trim();
        let filtered = this.detectedApps;

        if (this.activeCategoryFilter && this.activeCategoryFilter !== 'all') {
            filtered = filtered.filter(app => (app.type || '') === this.activeCategoryFilter);
        }

        if (query) {
            filtered = filtered.filter(app =>
                (app.name && app.name.toLowerCase().includes(query)) ||
                (app.type && app.type.toLowerCase().includes(query)) ||
                (app.publisher && app.publisher.toLowerCase().includes(query))
            );
        }

        const countEl = document.getElementById('detectedAppsCount');
        if (countEl) countEl.textContent = `${filtered.length} apps`;

        this.renderAppGrid(filtered, 'detectedAppsList');
    }

    renderAppGrid(apps, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (!apps || apps.length === 0) {
            container.innerHTML = '<div class="no-apps" style="grid-column: 1 / -1;">No matching applications found</div>';
            return;
        }

        container.innerHTML = apps.map(app => {
            const isSel = this.selectedApps.has(app.name);
            const isAll = this.allowedApps.has(app.name);
            const isBlk = this.blockedApps.has(app.name);

            return `
                <div class="app-item">
                    <div class="app-info">
                        <div class="app-name">${this.escapeHtml(app.name)}</div>
                        <div class="app-type"><i class="fas fa-tag"></i> ${this.escapeHtml(app.type || 'Installed Application')}</div>
                        ${app.publisher ? `<div class="app-publisher"><i class="fas fa-building"></i> ${this.escapeHtml(app.publisher)}</div>` : ''}
                    </div>
                    <div class="app-actions">
                        <button class="btn btn-sm ${isSel ? 'btn-success' : 'btn-outline'} add-app-action-btn" data-app="${this.escapeHtml(app.name)}" data-category="selected">
                            <i class="fas fa-lock"></i> ${isSel ? 'Selected' : 'Select'}
                        </button>
                        <button class="btn btn-sm ${isAll ? 'btn-info' : 'btn-outline'} add-app-action-btn" data-app="${this.escapeHtml(app.name)}" data-category="allowed">
                            <i class="fas fa-check"></i> ${isAll ? 'Allowed' : 'Allow'}
                        </button>
                        <button class="btn btn-sm ${isBlk ? 'btn-danger' : 'btn-outline'} add-app-action-btn" data-app="${this.escapeHtml(app.name)}" data-category="blocked">
                            <i class="fas fa-ban"></i> ${isBlk ? 'Blocked' : 'Block'}
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        // Attach action click listeners
        container.querySelectorAll('.add-app-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const targetBtn = e.target.closest('.add-app-action-btn');
                const appName = targetBtn.dataset.app;
                const category = targetBtn.dataset.category;
                this.addAppToCategory(appName, category);
            });
        });
    }

    async addAppToCategory(appName, category, appType = 'User Added') {
        try {
            const result = await ipcRenderer.invoke('add-app-manually', appName, category, appType);
            if (result.success) {
                // Update local sets
                this.selectedApps.delete(appName);
                this.allowedApps.delete(appName);
                this.blockedApps.delete(appName);

                if (category === 'selected') this.selectedApps.add(appName);
                else if (category === 'allowed') this.allowedApps.add(appName);
                else if (category === 'blocked') this.blockedApps.add(appName);

                this.showNotification(`Added "${appName}" to ${category} applications`, 'success');
                this.updateUI();
                this.filterDetectedApps(document.getElementById('searchApps') ? document.getElementById('searchApps').value : '');
            } else {
                this.showNotification(`Could not add app: ${result.error}`, 'error');
            }
        } catch (error) {
            this.showNotification(`Error: ${error.message}`, 'error');
        }
    }

    async removeAppFromCategory(appName) {
        try {
            const result = await ipcRenderer.invoke('remove-app', appName);
            if (result.success) {
                this.selectedApps.delete(appName);
                this.allowedApps.delete(appName);
                this.blockedApps.delete(appName);
                this.showNotification(`Removed "${appName}"`, 'info');
                this.updateUI();
                this.filterDetectedApps(document.getElementById('searchApps') ? document.getElementById('searchApps').value : '');
            } else {
                this.showNotification(`Error removing app: ${result.error}`, 'error');
            }
        } catch (error) {
            this.showNotification(`Error: ${error.message}`, 'error');
        }
    }

    // ==========================================
    // MANUAL APP MODAL
    // ==========================================

    showManualAppModal() {
        const nameInput = document.getElementById('manualAppName');
        if (nameInput) nameInput.value = '';
        document.getElementById('manualAppModal').style.display = 'flex';
    }

    async addManualApp() {
        const nameInput = document.getElementById('manualAppName');
        const catSelect = document.getElementById('manualAppCategory');

        const appName = nameInput ? nameInput.value.trim() : '';
        const category = catSelect ? catSelect.value : 'selected';

        if (!appName) {
            this.showNotification('Please enter an application name', 'warning');
            return;
        }

        await this.addAppToCategory(appName, category, 'Manual Entry');
        document.getElementById('manualAppModal').style.display = 'none';
    }

    // ==========================================
    // FILE UPLOAD / ATTACHMENT MODAL
    // ==========================================

    showFileUploadModal() {
        this.selectedUploadFiles = [];
        this.renderUploadedFilesList();
        document.getElementById('fileUploadModal').style.display = 'flex';
    }

    async openNativeFileDialog() {
        try {
            const result = await ipcRenderer.invoke('show-open-dialog', {
                title: 'Select Application Executable or Shortcut',
                properties: ['openFile', 'multiSelections'],
                filters: [
                    { name: 'Application Files', extensions: ['exe', 'lnk', 'bat', 'cmd', 'app'] },
                    { name: 'All Files', extensions: ['*'] }
                ]
            });

            if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
                for (const filePath of result.filePaths) {
                    if (!this.selectedUploadFiles.includes(filePath)) {
                        this.selectedUploadFiles.push(filePath);
                    }
                }
                this.renderUploadedFilesList();
            }
        } catch (error) {
            console.error('File dialog error:', error);
        }
    }

    handleDroppedFiles(fileList) {
        for (let i = 0; i < fileList.length; i++) {
            const file = fileList[i];
            const filePath = file.path || file.name;
            if (!this.selectedUploadFiles.includes(filePath)) {
                this.selectedUploadFiles.push(filePath);
            }
        }
        this.renderUploadedFilesList();
    }

    renderUploadedFilesList() {
        const container = document.getElementById('uploadedFiles');
        if (!container) return;

        if (this.selectedUploadFiles.length === 0) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = this.selectedUploadFiles.map((file, idx) => {
            const fileName = file.split(/[/\\]/).pop();
            return `
                <div class="uploaded-file-chip">
                    <span><i class="fas fa-file-code text-primary"></i> ${this.escapeHtml(fileName)}</span>
                    <button class="btn btn-sm btn-outline remove-file-btn" data-index="${idx}">&times;</button>
                </div>
            `;
        }).join('');

        container.querySelectorAll('.remove-file-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.target.dataset.index, 10);
                this.selectedUploadFiles.splice(idx, 1);
                this.renderUploadedFilesList();
            });
        });
    }

    async processUploadedFiles() {
        if (this.selectedUploadFiles.length === 0) {
            this.showNotification('Please select at least one file to add.', 'warning');
            return;
        }

        const targetCatEl = document.getElementById('uploadTargetCategory');
        const category = targetCatEl ? targetCatEl.value : 'selected';

        for (const filePath of this.selectedUploadFiles) {
            try {
                const res = await ipcRenderer.invoke('add-app-from-file', filePath, category);
                if (res.success && res.app) {
                    await this.addAppToCategory(res.app.name, category, res.app.type);
                } else {
                    const fallbackName = filePath.split(/[/\\]/).pop().replace(/\.[^/.]+$/, '');
                    await this.addAppToCategory(fallbackName, category, 'File Upload');
                }
            } catch (err) {
                console.warn('Error processing file:', filePath, err);
            }
        }

        this.showNotification(`Added ${this.selectedUploadFiles.length} files to ${category} apps!`, 'success');
        document.getElementById('fileUploadModal').style.display = 'none';
    }

    // ==========================================
    // PACKAGE MANAGER MODAL
    // ==========================================

    async showPackageManagerModal() {
        document.getElementById('packageManagerModal').style.display = 'flex';
        await this.browseSystemApps();
    }

    async browseSystemApps() {
        const listEl = document.getElementById('packageList');
        if (listEl) listEl.innerHTML = '<div class="no-apps" style="grid-column: 1 / -1;"><i class="fas fa-spinner fa-spin"></i> Scanning system software and packages...</div>';

        try {
            const result = await ipcRenderer.invoke('browse-system-apps');
            if (result.success && Array.isArray(result.apps)) {
                this.detectedApps = result.apps;
                this.filterPackageList(document.getElementById('searchPackages') ? document.getElementById('searchPackages').value : '');
            }
        } catch (error) {
            if (listEl) listEl.innerHTML = `<div class="no-apps" style="grid-column: 1 / -1;">Error browsing system: ${error.message}</div>`;
        }
    }

    filterPackageList(query = '') {
        const q = (query || '').toLowerCase().trim();
        let filtered = this.detectedApps;

        if (this.activePackageTab === 'office') {
            filtered = filtered.filter(a => (a.type || '').includes('Office') || /word|excel|powerpoint|outlook|onenote|teams|access|publisher/i.test(a.name));
        } else if (this.activePackageTab === 'productivity') {
            filtered = filtered.filter(a => (a.type || '').includes('Productivity') || /code|visual|notion|slack|zoom|figma|git/i.test(a.name));
        } else if (this.activePackageTab === 'pwa') {
            filtered = filtered.filter(a => (a.type || '').includes('PWA') || (a.type || '').includes('Progressive'));
        } else if (this.activePackageTab === 'media') {
            filtered = filtered.filter(a => (a.type || '').includes('Media') || /photoshop|spotify|vlc|blender|steam/i.test(a.name));
        }

        if (q) {
            filtered = filtered.filter(a =>
                (a.name && a.name.toLowerCase().includes(q)) ||
                (a.type && a.type.toLowerCase().includes(q)) ||
                (a.publisher && a.publisher.toLowerCase().includes(q))
            );
        }

        this.renderAppGrid(filtered, 'packageList');
    }

    // ==========================================
    // SESSION HISTORY
    // ==========================================

    loadSessionHistory() {
        const container = document.getElementById('sessionHistoryList');
        if (!container) return;

        if (!this.sessionStats || this.sessionStats.length === 0) {
            container.innerHTML = '<div class="no-apps">No past focus sessions recorded yet.</div>';
            return;
        }

        container.innerHTML = this.sessionStats.map(session => {
            const dateStr = session.startTime ? new Date(session.startTime).toLocaleDateString() : 'Recent';
            const timeStr = session.startTime ? new Date(session.startTime).toLocaleTimeString() : '';
            const prod = session.productivity !== undefined ? session.productivity : 100;

            return `
                <div class="session-history-item">
                    <div class="session-hist-left">
                        <h4>${this.escapeHtml(session.sessionName || 'Focus Session')}</h4>
                        <span class="session-hist-date"><i class="fas fa-clock"></i> ${dateStr} at ${timeStr}</span>
                    </div>
                    <div class="session-hist-stats">
                        <div class="hist-stat">
                            <span class="hist-stat-val text-info">${this.formatTime(session.totalDuration || 0)}</span>
                            <span class="hist-stat-lbl">Duration</span>
                        </div>
                        <div class="hist-stat">
                            <span class="hist-stat-val text-success">${this.formatTime(session.focusedTime || 0)}</span>
                            <span class="hist-stat-lbl">Focused</span>
                        </div>
                        <div class="hist-stat">
                            <span class="hist-stat-val text-danger">${session.blockedAttempts || 0}</span>
                            <span class="hist-stat-lbl">Blocks</span>
                        </div>
                        <div class="hist-stat">
                            <span class="hist-stat-val text-warning">${prod}%</span>
                            <span class="hist-stat-lbl">Productivity</span>
                        </div>
                        <button class="btn btn-sm btn-primary view-session-summary-btn" data-session-id="${session.sessionId}">
                            <i class="fas fa-file-alt"></i> View Brief
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        container.querySelectorAll('.view-session-summary-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const sid = e.target.closest('.view-session-summary-btn').dataset.sessionId;
                const found = this.sessionStats.find(s => s.sessionId === sid);
                if (found) {
                    this.showSessionSummary(found);
                }
            });
        });
    }

    // ==========================================
    // UI UPDATES & LIST RENDERING
    // ==========================================

    updateUI() {
        // Controls
        const startBtn = document.getElementById('startSessionBtn');
        if (startBtn) startBtn.disabled = this.sessionActive;

        const stopBtn = document.getElementById('stopSessionBtn');
        if (stopBtn) stopBtn.disabled = !this.sessionActive;

        // Status pill & badge
        const indicator = document.getElementById('statusIndicator');
        const statusText = document.getElementById('statusText');
        const sidebarPill = document.getElementById('sidebarStatusPill');
        const sidebarStatusText = document.getElementById('sidebarStatusText');

        if (this.sessionActive) {
            if (indicator) indicator.className = 'status-indicator active';
            if (statusText) statusText.textContent = 'Session Active (Locked In)';
            if (sidebarPill) sidebarPill.className = 'status-pill active';
            if (sidebarStatusText) sidebarStatusText.textContent = 'Locked In';
        } else {
            if (indicator) indicator.className = 'status-indicator';
            if (statusText) statusText.textContent = 'No Active Session';
            if (sidebarPill) sidebarPill.className = 'status-pill';
            if (sidebarStatusText) sidebarStatusText.textContent = 'Idle';
        }

        // Top counts
        const selCountEl = document.getElementById('selectedAppsCount');
        if (selCountEl) selCountEl.textContent = this.selectedApps.size;

        const blkCountEl = document.getElementById('blockedAppsCount');
        if (blkCountEl) blkCountEl.textContent = this.blockedApps.size;

        const totSessEl = document.getElementById('totalSessions');
        if (totSessEl) totSessEl.textContent = this.sessionStats.length;

        // Average productivity
        const avgProd = this.sessionStats.length > 0
            ? Math.round(this.sessionStats.reduce((sum, s) => sum + (s.productivity || 0), 0) / this.sessionStats.length)
            : 0;
        const prodScoreEl = document.getElementById('productivityScore');
        if (prodScoreEl) prodScoreEl.textContent = `${avgProd}%`;

        // Render dashboard lists
        this.renderCategoryList(Array.from(this.selectedApps), 'selectedAppsList');
        this.renderCategoryList(Array.from(this.blockedApps), 'blockedAppsList');

        // Render manage lists
        this.renderCategoryList(Array.from(this.selectedApps), 'selectedAppsListManage');
        this.renderCategoryList(Array.from(this.allowedApps), 'allowedAppsList');
        this.renderCategoryList(Array.from(this.blockedApps), 'blockedAppsListManage');

        // Headers
        const selHdr = document.getElementById('selectedAppsCountHeader');
        if (selHdr) selHdr.textContent = `${this.selectedApps.size} apps`;

        const blkHdr = document.getElementById('blockedAppsCountHeader');
        if (blkHdr) blkHdr.textContent = `${this.blockedApps.size} apps`;

        const selManageHdr = document.getElementById('selectedAppsCountManage');
        if (selManageHdr) selManageHdr.textContent = `${this.selectedApps.size} apps`;

        const allManageHdr = document.getElementById('allowedAppsCount');
        if (allManageHdr) allManageHdr.textContent = `${this.allowedApps.size} apps`;

        const blkManageHdr = document.getElementById('blockedAppsCountManage');
        if (blkManageHdr) blkManageHdr.textContent = `${this.blockedApps.size} apps`;
    }

    renderCategoryList(apps, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (!apps || apps.length === 0) {
            container.innerHTML = '<div class="no-apps">No applications configured</div>';
            return;
        }

        container.innerHTML = apps.map(appName => `
            <div class="app-item">
                <div class="app-info">
                    <div class="app-name">${this.escapeHtml(appName)}</div>
                </div>
                <div class="app-actions">
                    <button class="btn btn-sm btn-outline remove-app-btn" data-app="${this.escapeHtml(appName)}" title="Remove">
                        <i class="fas fa-trash-alt text-danger"></i>
                    </button>
                </div>
            </div>
        `).join('');

        container.querySelectorAll('.remove-app-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.target.closest('.remove-app-btn');
                const appName = target.dataset.app;
                this.removeAppFromCategory(appName);
            });
        });
    }

    // ==========================================
    // UTILITIES
    // ==========================================

    formatTime(seconds) {
        const sec = Math.max(0, Math.round(seconds || 0));
        if (sec < 60) {
            return `${sec}s`;
        } else if (sec < 3600) {
            const m = Math.floor(sec / 60);
            const s = sec % 60;
            return `${m}m ${s}s`;
        } else {
            const h = Math.floor(sec / 3600);
            const m = Math.floor((sec % 3600) / 60);
            return `${h}h ${m}m`;
        }
    }

    formatStatus(status) {
        const map = {
            'focused': 'Locked & Focused',
            'distracted': 'Distracted (Blocked)',
            'blocked': 'Blocked App Terminated',
            'inactive': 'Inactive'
        };
        return map[status] || status;
    }

    escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    showNotification(message, type = 'info') {
        const existing = document.querySelectorAll('.app-toast');
        existing.forEach(t => t.remove());

        const toast = document.createElement('div');
        toast.className = `app-toast toast-${type}`;
        
        let icon = 'info-circle';
        if (type === 'success') icon = 'check-circle';
        if (type === 'error') icon = 'exclamation-circle';
        if (type === 'warning') icon = 'exclamation-triangle';

        toast.innerHTML = `
            <i class="fas fa-${icon}"></i>
            <span>${this.escapeHtml(message)}</span>
        `;

        document.body.appendChild(toast);

        if (!document.getElementById('toast-styles')) {
            const s = document.createElement('style');
            s.id = 'toast-styles';
            s.textContent = `
                .app-toast {
                    position: fixed;
                    bottom: 24px;
                    right: 24px;
                    padding: 12px 20px;
                    border-radius: 10px;
                    font-size: 0.88rem;
                    font-weight: 500;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    color: white;
                    box-shadow: 0 10px 25px rgba(0,0,0,0.5);
                    z-index: 10000;
                    animation: toastIn 0.25s ease-out;
                }
                .toast-info { background-color: #0284c7; border: 1px solid #38bdf8; }
                .toast-success { background-color: #059669; border: 1px solid #34d399; }
                .toast-error { background-color: #dc2626; border: 1px solid #f87171; }
                .toast-warning { background-color: #d97706; border: 1px solid #fbbf24; color: #000; }
                @keyframes toastIn {
                    from { transform: translateY(20px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
            `;
            document.head.appendChild(s);
        }

        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 3500);
    }

    async clearAllData() {
        if (confirm('Are you sure you want to reset and clear all data, lists, and session history?')) {
            try {
                await ipcRenderer.invoke('clear-all-data');
                this.selectedApps.clear();
                this.allowedApps.clear();
                this.blockedApps.clear();
                this.sessionStats = [];
                this.showNotification('All data cleared successfully', 'success');
                this.updateUI();
                this.loadSessionHistory();
            } catch (err) {
                this.showNotification(`Error: ${err.message}`, 'error');
            }
        }
    }

    async exportData() {
        const data = {
            selectedApps: Array.from(this.selectedApps),
            allowedApps: Array.from(this.allowedApps),
            blockedApps: Array.from(this.blockedApps),
            sessionStats: this.sessionStats,
            exportedAt: new Date().toISOString()
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `locked-in-focus-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this.showNotification('Data exported to JSON file', 'success');
    }

    saveSettings() {
        this.showNotification('Preferences saved successfully!', 'success');
    }
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    window.focusApp = new FocusAppRenderer();
});