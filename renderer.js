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
        this.currentFocusData = {
            currentApp: 'None',
            status: 'Inactive',
            focusedTime: 0,
            distractedTime: 0,
            blockedCount: 0
        };

        this.initializeEventListeners();
        this.loadInitialData();
        this.updateUI();
    }

    initializeEventListeners() {
        // Navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                this.handleNavigation(e.target.closest('.nav-item').id);
            });
        });

        // Session Controls
        document.getElementById('startSessionBtn').addEventListener('click', () => this.startSession());
        document.getElementById('stopSessionBtn').addEventListener('click', () => this.stopSession());

        // App Management
        document.getElementById('scanAppsBtn').addEventListener('click', () => this.scanApps());
        document.getElementById('addManualAppBtn').addEventListener('click', () => this.showManualAppModal());
        document.getElementById('uploadAppBtn').addEventListener('click', () => this.showFileUploadModal());
        document.getElementById('packageManagerBtn').addEventListener('click', () => this.showPackageManagerModal());

        // Settings
        document.getElementById('saveSettingsBtn').addEventListener('click', () => this.saveSettings());
        document.getElementById('clearDataBtn').addEventListener('click', () => this.clearAllData());
        document.getElementById('exportDataBtn').addEventListener('click', () => this.exportData());

        // Search
        document.getElementById('searchApps').addEventListener('input', (e) => this.searchApps(e.target.value));

        // Modal Controls
        this.initializeModalControls();
        
        // IPC Event Listeners
        this.setupIpcListeners();
    }

    setupIpcListeners() {
        // Session updates
        ipcRenderer.on('session-update', (event, data) => {
            this.handleSessionUpdate(data);
        });

        // Focus updates
        ipcRenderer.on('focus-update', (event, data) => {
            this.updateFocusDisplay(data);
        });

        // App approval requests
        ipcRenderer.on('app-approval-request', (event, data) => {
            this.showAppApprovalModal(data);
        });

        // Session summary
        ipcRenderer.on('session-summary', (event, data) => {
            this.showSessionSummary(data);
        });
    }

    initializeModalControls() {
        // Close modals when clicking X
        document.querySelectorAll('.modal .close').forEach(closeBtn => {
            closeBtn.addEventListener('click', (e) => {
                e.target.closest('.modal').style.display = 'none';
            });
        });

        // Close modals when clicking outside
        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                e.target.style.display = 'none';
            }
        });

        // Manual App Modal
        document.getElementById('saveManualAppBtn').addEventListener('click', () => this.addManualApp());
        document.getElementById('cancelManualAppBtn').addEventListener('click', () => {
            document.getElementById('manualAppModal').style.display = 'none';
        });

        // App Approval Modal
        document.getElementById('approveAppBtn').addEventListener('click', () => this.handleAppApproval(true));
        document.getElementById('denyAppBtn').addEventListener('click', () => this.handleAppApproval(false));

        // Package Manager
        document.getElementById('browseSystemBtn').addEventListener('click', () => this.browseSystemApps());

        // File Upload
        document.getElementById('fileInput').addEventListener('change', (e) => this.handleFileSelection(e));
        document.getElementById('processFilesBtn').addEventListener('click', () => this.processUploadedFiles());
        document.getElementById('cancelUploadBtn').addEventListener('click', () => {
            document.getElementById('fileUploadModal').style.display = 'none';
        });

        // Upload area click
        document.getElementById('uploadArea').addEventListener('click', () => {
            document.getElementById('fileInput').click();
        });
    }

    async loadInitialData() {
        try {
            // Load app lists
            const appLists = await ipcRenderer.invoke('get-app-lists');
            this.selectedApps = new Set(appLists.selectedApps);
            this.allowedApps = new Set(appLists.allowedApps);
            this.blockedApps = new Set(appLists.blockedApps);

            // Load session stats
            this.sessionStats = await ipcRenderer.invoke('get-session-stats');

            // Get session status
            const sessionStatus = await ipcRenderer.invoke('get-session-status');
            this.sessionActive = sessionStatus.active;
            this.currentSession = sessionStatus.session;

            this.updateUI();
        } catch (error) {
            console.error('Error loading initial data:', error);
        }
    }

    handleNavigation(navId) {
        // Update active nav item
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });
        document.getElementById(navId).classList.add('active');

        // Show corresponding section
        document.querySelectorAll('.content-section').forEach(section => {
            section.classList.remove('active');
        });

        switch (navId) {
            case 'nav-dashboard':
                document.getElementById('dashboardSection').classList.add('active');
                break;
            case 'nav-apps':
                document.getElementById('appsSection').classList.add('active');
                break;
            case 'nav-detection':
                document.getElementById('detectionSection').classList.add('active');
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

    async startSession() {
        const sessionName = document.getElementById('sessionName').value || 'My Focus Session';
        const checkInterval = parseInt(document.getElementById('checkInterval').value) || 2000;

        const settings = {
            name: sessionName,
            checkInterval: checkInterval
        };

        try {
            const result = await ipcRenderer.invoke('start-session', settings);
            
            if (result.success) {
                this.showNotification('Session started successfully!', 'success');
                this.sessionActive = true;
                this.currentSession = result.session;
            } else {
                this.showNotification(`Failed to start session: ${result.error}`, 'error');
            }
        } catch (error) {
            this.showNotification(`Error starting session: ${error.message}`, 'error');
        }

        this.updateUI();
    }

    async stopSession() {
        try {
            const result = await ipcRenderer.invoke('stop-session');
            
            if (result.success) {
                this.showNotification('Session stopped successfully!', 'success');
                this.sessionActive = false;
                this.currentSession = null;
            } else {
                this.showNotification(`Failed to stop session: ${result.error}`, 'error');
            }
        } catch (error) {
            this.showNotification(`Error stopping session: ${error.message}`, 'error');
        }

        this.updateUI();
    }

    handleSessionUpdate(data) {
        this.sessionActive = data.active;
        this.currentSession = data.session;
        this.updateUI();
    }

    updateFocusDisplay(data) {
        this.currentFocusData = {
            currentApp: data.app || 'None',
            status: data.status || 'Inactive',
            focusedTime: data.focusedTime || 0,
            distractedTime: data.distractedTime || 0,
            blockedCount: data.blockedAttempts || 0
        };

        document.getElementById('currentApp').textContent = this.currentFocusData.currentApp;
        document.getElementById('focusStatus').textContent = this.formatStatus(this.currentFocusData.status);
        document.getElementById('focusedTime').textContent = this.formatTime(this.currentFocusData.focusedTime);
        document.getElementById('distractedTime').textContent = this.formatTime(this.currentFocusData.distractedTime);
        document.getElementById('blockedCount').textContent = this.currentFocusData.blockedCount;
    }

    async scanApps() {
        try {
            this.showNotification('Scanning for applications...', 'info');
            
            const result = await ipcRenderer.invoke('scan-apps');
            
            if (result.success) {
                this.detectedApps = result.apps;
                this.showNotification(`Found ${result.apps.length} applications`, 'success');
                this.displayDetectedApps();
            } else {
                this.showNotification(`Scan failed: ${result.error}`, 'error');
            }
        } catch (error) {
            this.showNotification(`Error scanning apps: ${error.message}`, 'error');
        }
    }

    async searchApps(query) {
        if (!query.trim()) {
            this.displayDetectedApps();
            return;
        }

        try {
            const filteredApps = await ipcRenderer.invoke('search-apps', query);
            this.displayApps(filteredApps, 'detectedAppsList');
        } catch (error) {
            console.error('Error searching apps:', error);
        }
    }

    displayDetectedApps() {
        this.displayApps(this.detectedApps, 'detectedAppsList');
        document.getElementById('detectedAppsCount').textContent = `${this.detectedApps.length} apps`;
    }

    displayApps(apps, containerId) {
        const container = document.getElementById(containerId);
        
        if (!apps || apps.length === 0) {
            container.innerHTML = '<div class="no-apps">No applications found</div>';
            return;
        }

        container.innerHTML = apps.map(app => `
            <div class="app-item">
                <div class="app-info">
                    <div class="app-name">${app.name}</div>
                    <div class="app-type">${app.type || 'Unknown Type'}</div>
                    ${app.publisher ? `<div class="app-publisher">${app.publisher}</div>` : ''}
                </div>
                <div class="app-actions">
                    <button class="btn btn-sm btn-success add-app-btn" data-app="${app.name}" data-category="selected">
                        <i class="fas fa-plus"></i> Select
                    </button>
                    <button class="btn btn-sm btn-info add-app-btn" data-app="${app.name}" data-category="allowed">
                        <i class="fas fa-check"></i> Allow
                    </button>
                    <button class="btn btn-sm btn-danger add-app-btn" data-app="${app.name}" data-category="blocked">
                        <i class="fas fa-ban"></i> Block
                    </button>
                </div>
            </div>
        `).join('');

        // Add event listeners to action buttons
        container.querySelectorAll('.add-app-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const appName = e.target.closest('.add-app-btn').dataset.app;
                const category = e.target.closest('.add-app-btn').dataset.category;
                this.addAppToCategory(appName, category);
            });
        });
    }

    async addAppToCategory(appName, category) {
        try {
            const result = await ipcRenderer.invoke('add-app-manually', appName, category);
            
            if (result.success) {
                if (category === 'selected') {
                    this.selectedApps.add(appName);
                } else if (category === 'allowed') {
                    this.allowedApps.add(appName);
                } else if (category === 'blocked') {
                    this.blockedApps.add(appName);
                }

                this.showNotification(`Added ${appName} to ${category} apps`, 'success');
                this.updateUI();
                await ipcRenderer.invoke('save-data');
            } else {
                this.showNotification(`Failed to add app: ${result.error}`, 'error');
            }
        } catch (error) {
            this.showNotification(`Error adding app: ${error.message}`, 'error');
        }
    }

    showManualAppModal() {
        document.getElementById('manualAppName').value = '';
        document.getElementById('manualAppCategory').value = 'selected';
        document.getElementById('manualAppModal').style.display = 'block';
    }

    async addManualApp() {
        const appName = document.getElementById('manualAppName').value.trim();
        const category = document.getElementById('manualAppCategory').value;

        if (!appName) {
            this.showNotification('Please enter an application name', 'error');
            return;
        }

        try {
            const result = await ipcRenderer.invoke('add-app-manually', appName, category);
            
            if (result.success) {
                if (category === 'selected') {
                    this.selectedApps.add(appName);
                } else if (category === 'allowed') {
                    this.allowedApps.add(appName);
                } else if (category === 'blocked') {
                    this.blockedApps.add(appName);
                }

                this.showNotification(`Added ${appName} to ${category} apps`, 'success');
                document.getElementById('manualAppModal').style.display = 'none';
                this.updateUI();
                await ipcRenderer.invoke('save-data');
            } else {
                this.showNotification(`Failed to add app: ${result.error}`, 'error');
            }
        } catch (error) {
            this.showNotification(`Error adding app: ${error.message}`, 'error');
        }
    }

    showFileUploadModal() {
        document.getElementById('uploadedFiles').innerHTML = '';
        document.getElementById('fileUploadModal').style.display = 'block';
    }

    handleFileSelection(event) {
        const files = Array.from(event.target.files);
        const uploadedFilesContainer = document.getElementById('uploadedFiles');
        
        uploadedFilesContainer.innerHTML = files.map(file => `
            <div class="uploaded-file">
                <i class="fas fa-file"></i>
                <span class="file-name">${file.name}</span>
                <span class="file-size">(${this.formatFileSize(file.size)})</span>
            </div>
        `).join('');
    }

    async processUploadedFiles() {
        const files = document.getElementById('fileInput').files;
        
        if (files.length === 0) {
            this.showNotification('Please select files to upload', 'error');
            return;
        }

        try {
            for (let file of files) {
                // For now, we'll just add the filename as an app
                const appName = file.name.replace(/\.[^/.]+$/, ""); // Remove extension
                await this.addAppToCategory(appName, 'selected');
            }
            
            this.showNotification(`Processed ${files.length} files`, 'success');
            document.getElementById('fileUploadModal').style.display = 'none';
        } catch (error) {
            this.showNotification(`Error processing files: ${error.message}`, 'error');
        }
    }

    showPackageManagerModal() {
        document.getElementById('packageManagerModal').style.display = 'block';
    }

    async browseSystemApps() {
        try {
            const result = await ipcRenderer.invoke('browse-system-apps');
            
            if (result.success) {
                this.displayApps(result.apps, 'packageList');
            } else {
                this.showNotification(`Failed to browse system: ${result.error}`, 'error');
            }
        } catch (error) {
            this.showNotification(`Error browsing system: ${error.message}`, 'error');
        }
    }

    showAppApprovalModal(data) {
        this.currentApprovalRequest = data;
        document.getElementById('approvalMessage').textContent = data.message;
        document.getElementById('appApprovalModal').style.display = 'block';
    }

    async handleAppApproval(approved) {
        if (this.currentApprovalRequest) {
            try {
                await ipcRenderer.invoke('handle-app-approval', this.currentApprovalRequest.requestId, approved);
                
                if (approved) {
                    this.showNotification(`Allowed access to ${this.currentApprovalRequest.appName}`, 'info');
                } else {
                    this.showNotification(`Blocked access to ${this.currentApprovalRequest.appName}`, 'warning');
                }
            } catch (error) {
                this.showNotification(`Error handling approval: ${error.message}`, 'error');
            }
            
            this.currentApprovalRequest = null;
            document.getElementById('appApprovalModal').style.display = 'none';
        }
    }

    showSessionSummary(summary) {
        const content = document.getElementById('sessionSummaryContent');
        
        content.innerHTML = `
            <div class="session-summary">
                <div class="summary-header">
                    <h4>${summary.sessionName}</h4>
                    <p>${new Date(summary.startTime).toLocaleString()} - ${new Date(summary.endTime).toLocaleString()}</p>
                </div>
                
                <div class="summary-stats">
                    <div class="stat-row">
                        <span class="stat-label">Total Duration:</span>
                        <span class="stat-value">${this.formatTime(summary.totalDuration)}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Focused Time:</span>
                        <span class="stat-value">${this.formatTime(summary.focusedTime)}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Distracted Time:</span>
                        <span class="stat-value">${this.formatTime(summary.distractedTime)}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Blocked Attempts:</span>
                        <span class="stat-value">${summary.blockedAttempts}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Productivity Score:</span>
                        <span class="stat-value">${summary.productivity}%</span>
                    </div>
                </div>

                ${summary.distractionDetails.length > 0 ? `
                <div class="distraction-breakdown">
                    <h5>Distraction Breakdown:</h5>
                    ${summary.distractionDetails.map(detail => `
                        <div class="distraction-item">
                            <span class="app-name">${detail.appName}</span>
                            <span class="time-spent">${this.formatTime(detail.timeSpent)}</span>
                            <span class="attempts">${detail.attempts} attempts</span>
                        </div>
                    `).join('')}
                </div>
                ` : ''}

                ${summary.appUsageBreakdown.length > 0 ? `
                <div class="usage-breakdown">
                    <h5>App Usage:</h5>
                    ${summary.appUsageBreakdown.map(usage => `
                        <div class="usage-item">
                            <span class="app-name">${usage.appName}</span>
                            <span class="time-spent">${this.formatTime(usage.timeSpent)}</span>
                        </div>
                    `).join('')}
                </div>
                ` : ''}
            </div>
        `;

        document.getElementById('sessionSummaryModal').style.display = 'block';
    }

    async loadSessionHistory() {
        const container = document.getElementById('sessionHistoryList');
        
        if (this.sessionStats.length === 0) {
            container.innerHTML = '<div class="no-apps">No session history available</div>';
            return;
        }

        container.innerHTML = this.sessionStats.map(session => `
            <div class="session-history-item">
                <div class="session-info">
                    <div class="session-name">${session.sessionName}</div>
                    <div class="session-date">${new Date(session.startTime).toLocaleDateString()}</div>
                </div>
                <div class="session-stats">
                    <span class="stat">${this.formatTime(session.totalDuration)}</span>
                    <span class="stat">${session.productivity}%</span>
                    <span class="stat">${session.blockedAttempts} blocks</span>
                </div>
                <div class="session-actions">
                    <button class="btn btn-sm btn-info view-summary-btn" data-session-id="${session.sessionId}">
                        <i class="fas fa-chart-bar"></i> View
                    </button>
                </div>
            </div>
        `).join('');

        // Add event listeners to view buttons
        container.querySelectorAll('.view-summary-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const sessionId = e.target.closest('.view-summary-btn').dataset.sessionId;
                const session = this.sessionStats.find(s => s.sessionId === sessionId);
                if (session) {
                    this.showSessionSummary(session);
                }
            });
        });
    }

    async saveSettings() {
        const settings = {
            checkInterval: parseInt(document.getElementById('checkInterval').value) || 2000,
            autoStart: document.getElementById('autoStart').checked,
            notifications: document.getElementById('notifications').checked,
            focusMode: document.getElementById('focusMode').value
        };

        // In a real app, you'd save these to a settings file
        localStorage.setItem('appSettings', JSON.stringify(settings));
        this.showNotification('Settings saved successfully!', 'success');
    }

    async clearAllData() {
        if (confirm('Are you sure you want to clear all data? This action cannot be undone.')) {
            try {
                const result = await ipcRenderer.invoke('clear-all-data');
                
                if (result.success) {
                    this.selectedApps.clear();
                    this.allowedApps.clear();
                    this.blockedApps.clear();
                    this.sessionStats = [];
                    this.showNotification('All data cleared successfully!', 'success');
                    this.updateUI();
                } else {
                    this.showNotification(`Failed to clear data: ${result.error}`, 'error');
                }
            } catch (error) {
                this.showNotification(`Error clearing data: ${error.message}`, 'error');
            }
        }
    }

    async exportData() {
        // Simple export implementation - in real app, you'd use dialog to save file
        const data = {
            selectedApps: Array.from(this.selectedApps),
            allowedApps: Array.from(this.allowedApps),
            blockedApps: Array.from(this.blockedApps),
            sessionStats: this.sessionStats
        };

        const dataStr = JSON.stringify(data, null, 2);
        const dataBlob = new Blob([dataStr], {type: 'application/json'});
        
        // Create download link
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `locked-in-data-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        this.showNotification('Data exported successfully!', 'success');
    }

    updateUI() {
        // Update session controls
        document.getElementById('startSessionBtn').disabled = this.sessionActive;
        document.getElementById('stopSessionBtn').disabled = !this.sessionActive;

        // Update status indicator
        const statusIndicator = document.getElementById('statusIndicator');
        const statusText = document.getElementById('statusText');
        
        if (this.sessionActive) {
            statusIndicator.className = 'status-indicator active';
            statusText.textContent = 'Session Active';
        } else {
            statusIndicator.className = 'status-indicator';
            statusText.textContent = 'No Active Session';
        }

        // Update app counts
        document.getElementById('selectedAppsCount').textContent = this.selectedApps.size;
        document.getElementById('blockedAppsCount').textContent = this.blockedApps.size;
        document.getElementById('totalSessions').textContent = this.sessionStats.length;
        
        // Calculate average productivity
        const avgProductivity = this.sessionStats.length > 0 
            ? Math.round(this.sessionStats.reduce((sum, session) => sum + session.productivity, 0) / this.sessionStats.length)
            : 0;
        document.getElementById('productivityScore').textContent = `${avgProductivity}%`;

        // Update app lists
        this.updateAppLists();
    }

    updateAppLists() {
        // Dashboard lists
        this.displayAppList(Array.from(this.selectedApps), 'selectedAppsList');
        this.displayAppList(Array.from(this.blockedApps), 'blockedAppsList');

        // Management lists
        this.displayAppList(Array.from(this.selectedApps), 'selectedAppsListManage');
        this.displayAppList(Array.from(this.allowedApps), 'allowedAppsList');
        this.displayAppList(Array.from(this.blockedApps), 'blockedAppsListManage');

        // Update counts
        document.getElementById('selectedAppsCountHeader').textContent = `${this.selectedApps.size} apps`;
        document.getElementById('blockedAppsCountHeader').textContent = `${this.blockedApps.size} apps`;
        document.getElementById('selectedAppsCountManage').textContent = `${this.selectedApps.size} apps`;
        document.getElementById('allowedAppsCount').textContent = `${this.allowedApps.size} apps`;
        document.getElementById('blockedAppsCountManage').textContent = `${this.blockedApps.size} apps`;
    }

    displayAppList(apps, containerId) {
        const container = document.getElementById(containerId);
        
        if (apps.length === 0) {
            container.innerHTML = '<div class="no-apps">No applications</div>';
            return;
        }

        container.innerHTML = apps.map(appName => `
            <div class="app-item">
                <div class="app-info">
                    <div class="app-name">${appName}</div>
                </div>
                <div class="app-actions">
                    <button class="btn btn-sm btn-danger remove-app-btn" data-app="${appName}">
                        <i class="fas fa-trash"></i> Remove
                    </button>
                </div>
            </div>
        `).join('');

        // Add event listeners to remove buttons
        container.querySelectorAll('.remove-app-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const appName = e.target.closest('.remove-app-btn').dataset.app;
                if (confirm(`Remove "${appName}" from list?`)) {
                    try {
                        const result = await ipcRenderer.invoke('remove-app', appName);
                        
                        if (result.success) {
                            this.selectedApps.delete(appName);
                            this.allowedApps.delete(appName);
                            this.blockedApps.delete(appName);
                            this.showNotification(`Removed ${appName}`, 'success');
                            this.updateUI();
                        } else {
                            this.showNotification(`Failed to remove app: ${result.error}`, 'error');
                        }
                    } catch (error) {
                        this.showNotification(`Error removing app: ${error.message}`, 'error');
                    }
                }
            });
        });
    }

    // Utility methods
    formatTime(seconds) {
        if (seconds < 60) {
            return `${Math.round(seconds)}s`;
        } else if (seconds < 3600) {
            return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
        } else {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            return `${hours}h ${minutes}m`;
        }
    }

    formatStatus(status) {
        const statusMap = {
            'focused': 'Focused',
            'distracted': 'Distracted',
            'blocked': 'Blocked',
            'unknown': 'Unknown App',
            'inactive': 'Inactive'
        };
        return statusMap[status] || status;
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    showNotification(message, type = 'info') {
        // Simple notification implementation
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <i class="fas fa-${type === 'success' ? 'check' : type === 'error' ? 'exclamation-triangle' : 'info'}-circle"></i>
                <span>${message}</span>
            </div>
        `;

        document.body.appendChild(notification);

        // Add styles if not already added
        if (!document.getElementById('notification-styles')) {
            const styles = document.createElement('style');
            styles.id = 'notification-styles';
            styles.textContent = `
                .notification {
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    padding: 12px 20px;
                    border-radius: 8px;
                    color: white;
                    z-index: 10000;
                    max-width: 300px;
                    animation: slideIn 0.3s ease-out;
                }
                .notification-success { background: #28a745; }
                .notification-error { background: #dc3545; }
                .notification-info { background: #17a2b8; }
                .notification-warning { background: #ffc107; color: #212529; }
                @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
            `;
            document.head.appendChild(styles);
        }

        // Remove after 3 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 3000);
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new FocusAppRenderer();
});