const { ipcRenderer } = require('electron');

class FocusAppRenderer {
    constructor() {
        this.currentSession = null;
        this.selectedApps = new Set();
        this.allowedApps = new Set();
        this.blockedApps = new Set();
        this.detectedApps = [];
        this.sessionStats = [];
        
        this.initializeEventListeners();
        this.loadInitialData();
    }

    initializeEventListeners() {
        // Navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const targetId = e.currentTarget.id.replace('nav-', '') + 'Section';
                this.showSection(targetId);
                
                // Update active nav
                document.querySelectorAll('.nav-item').forEach(nav => {
                    nav.classList.remove('active');
                });
                e.currentTarget.classList.add('active');
            });
        });

        // Session controls
        document.getElementById('startSessionBtn').addEventListener('click', () => this.startSession());
        document.getElementById('stopSessionBtn').addEventListener('click', () => this.stopSession());

        // App scanning
        document.getElementById('scanAppsBtn').addEventListener('click', () => this.scanApps());
        document.getElementById('searchApps').addEventListener('input', (e) => this.searchApps(e.target.value));

        // App management
        document.getElementById('addManualAppBtn').addEventListener('click', () => this.showAddManualAppModal());
        document.getElementById('uploadAppBtn').addEventListener('click', () => this.showUploadAppModal());
        document.getElementById('packageManagerBtn').addEventListener('click', () => this.showPackageManagerModal());

        // Modal controls
        document.getElementById('closeManualModal').addEventListener('click', () => this.hideModal('addManualAppModal'));
        document.getElementById('closeUploadModal').addEventListener('click', () => this.hideModal('uploadAppModal'));
        document.getElementById('closePackageModal').addEventListener('click', () => this.hideModal('packageManagerModal'));
        document.getElementById('closeApprovalModal').addEventListener('click', () => this.hideModal('approvalModal'));
        document.getElementById('closeSummaryModal').addEventListener('click', () => this.hideModal('sessionSummaryModal'));

        // Form submissions
        document.getElementById('manualAppForm').addEventListener('submit', (e) => this.handleManualAppSubmit(e));
        
        // App approval
        document.getElementById('approveAppBtn').addEventListener('click', () => this.handleAppApproval(true));
        document.getElementById('denyAppBtn').addEventListener('click', () => this.handleAppApproval(false));

        // Data management
        document.getElementById('clearDataBtn').addEventListener('click', () => this.clearAllData());
        document.getElementById('exportDataBtn').addEventListener('click', () => this.exportData());

        // IPC listeners
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
            this.showApprovalDialog(data);
        });

        // Session summary
        ipcRenderer.on('session-summary', (event, data) => {
            this.showSessionSummary(data);
        });
    }

    async loadInitialData() {
        try {
            await ipcRenderer.invoke('load-data');
            const appLists = await ipcRenderer.invoke('get-app-lists');
            this.selectedApps = new Set(appLists.selectedApps);
            this.allowedApps = new Set(appLists.allowedApps);
            this.blockedApps = new Set(appLists.blockedApps);
            
            this.sessionStats = await ipcRenderer.invoke('get-session-stats');
            
            this.updateUI();
            this.showNotification('App loaded successfully!', 'success');
        } catch (error) {
            console.error('Error loading initial data:', error);
        }
    }

    updateUI() {
        this.updateAppLists();
        this.updateStats();
        this.updateSessionUI();
    }

    updateAppLists() {
        this.updateAppList('selectedAppsList', Array.from(this.selectedApps), 'selected');
        this.updateAppList('blockedAppsList', Array.from(this.blockedApps), 'blocked');
        this.updateAppList('allowedAppsList', Array.from(this.allowedApps), 'allowed');
    }

    updateAppList(containerId, apps, category) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';

        if (apps.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-${this.getCategoryIcon(category)}"></i>
                    <p>No ${category} applications</p>
                </div>
            `;
            return;
        }

        apps.forEach(appName => {
            const div = document.createElement('div');
            div.className = 'app-item';
            div.innerHTML = `
                <div class="app-info">
                    <div class="app-name">${this.escapeHtml(appName)}</div>
                </div>
                <div class="app-actions">
                    <button class="btn btn-sm btn-danger remove-app" data-app="${this.escapeHtml(appName)}" data-category="${category}">
                        <i class="fas fa-trash"></i> Remove
                    </button>
                </div>
            `;

            div.querySelector('.remove-app').addEventListener('click', (e) => {
                const appName = e.target.closest('button').dataset.app;
                const category = e.target.closest('button').dataset.category;
                this.removeAppFromCategory(appName, category);
            });

            container.appendChild(div);
        });
    }

    getCategoryIcon(category) {
        switch(category) {
            case 'selected': return 'check-circle';
            case 'blocked': return 'ban';
            case 'allowed': return 'check';
            default: return 'app';
        }
    }

    updateStats() {
        document.getElementById('selectedAppsCount').textContent = this.selectedApps.size;
        document.getElementById('blockedAppsCount').textContent = this.blockedApps.size;
        document.getElementById('totalSessions').textContent = this.sessionStats.length;
        
        const avgProductivity = this.sessionStats.length > 0 
            ? Math.round(this.sessionStats.reduce((sum, stat) => sum + stat.productivity, 0) / this.sessionStats.length)
            : 0;
        document.getElementById('productivityScore').textContent = `${avgProductivity}%`;
    }

    async scanApps() {
        try {
            this.showLoading('scanAppsBtn', 'Scanning...');
            
            const result = await ipcRenderer.invoke('scan-apps');
            
            if (result.success) {
                this.detectedApps = result.apps;
                this.displayDetectedApps(this.detectedApps);
                this.showNotification(`Found ${result.count} applications!`, 'success');
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('Error scanning apps:', error);
            this.showNotification(`Scan failed: ${error.message}`, 'error');
        } finally {
            this.hideLoading('scanAppsBtn');
        }
    }

    displayDetectedApps(apps) {
        const container = document.getElementById('detectedAppsList');
        container.innerHTML = '';

        if (apps.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-search"></i>
                    <p>No applications found</p>
                </div>
            `;
            return;
        }

        apps.forEach(app => {
            const appElement = this.createDetectedAppElement(app);
            container.appendChild(appElement);
        });
    }

    createDetectedAppElement(app) {
        const div = document.createElement('div');
        div.className = 'app-item';
        div.innerHTML = `
            <div class="app-info">
                <div class="app-name">${this.escapeHtml(app.name)}</div>
                <div class="app-details">
                    <span class="app-type">${this.escapeHtml(app.type)}</span>
                    <span class="app-publisher">${this.escapeHtml(app.publisher || 'Unknown')}</span>
                </div>
                <div class="app-path">${this.escapeHtml(app.path)}</div>
            </div>
            <div class="app-actions">
                <button class="btn btn-sm btn-primary add-to-selected" data-app="${this.escapeHtml(app.name)}">
                    <i class="fas fa-check-circle"></i> Select
                </button>
                <button class="btn btn-sm btn-warning add-to-blocked" data-app="${this.escapeHtml(app.name)}">
                    <i class="fas fa-ban"></i> Block
                </button>
            </div>
        `;

        div.querySelector('.add-to-selected').addEventListener('click', (e) => {
            const appName = e.target.closest('button').dataset.app;
            this.addAppToCategory(appName, 'selected');
        });

        div.querySelector('.add-to-blocked').addEventListener('click', (e) => {
            const appName = e.target.closest('button').dataset.app;
            this.addAppToCategory(appName, 'blocked');
        });

        return div;
    }

    async addAppToCategory(appName, category) {
        try {
            const result = await ipcRenderer.invoke('add-app-manually', appName, category);
            
            if (result.success) {
                if (category === 'selected') {
                    this.selectedApps.add(appName);
                } else if (category === 'blocked') {
                    this.blockedApps.add(appName);
                } else if (category === 'allowed') {
                    this.allowedApps.add(appName);
                }
                
                this.updateUI();
                this.showNotification(`Added ${appName} to ${category} apps`, 'success');
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('Error adding app:', error);
            this.showNotification(`Failed to add app: ${error.message}`, 'error');
        }
    }

    async removeAppFromCategory(appName, category) {
        try {
            const result = await ipcRenderer.invoke('remove-app', appName);
            
            if (result.success) {
                if (category === 'selected') {
                    this.selectedApps.delete(appName);
                } else if (category === 'blocked') {
                    this.blockedApps.delete(appName);
                } else if (category === 'allowed') {
                    this.allowedApps.delete(appName);
                }
                
                this.updateUI();
                this.showNotification(`Removed ${appName} from ${category} apps`, 'success');
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('Error removing app:', error);
            this.showNotification(`Failed to remove app: ${error.message}`, 'error');
        }
    }

    async startSession() {
        if (this.selectedApps.size === 0) {
            this.showNotification('Please select at least one application before starting a session', 'warning');
            return;
        }

        try {
            const sessionName = document.getElementById('sessionName').value || `Session ${new Date().toLocaleString()}`;
            const checkInterval = 2000; // Default interval

            const settings = {
                name: sessionName,
                checkInterval: checkInterval
            };

            this.showLoading('startSessionBtn', 'Starting...');
            
            const result = await ipcRenderer.invoke('start-session', settings);
            
            if (result.success) {
                this.currentSession = result.sessionId;
                this.updateSessionUI(true);
                this.showNotification('Session started successfully!', 'success');
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('Error starting session:', error);
            this.showNotification(`Failed to start session: ${error.message}`, 'error');
        } finally {
            this.hideLoading('startSessionBtn');
        }
    }

    async stopSession() {
        try {
            this.showLoading('stopSessionBtn', 'Stopping...');
            
            const result = await ipcRenderer.invoke('stop-session');
            
            if (result.success) {
                this.currentSession = null;
                this.updateSessionUI(false);
                this.showNotification('Session stopped successfully!', 'success');
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('Error stopping session:', error);
            this.showNotification(`Failed to stop session: ${error.message}`, 'error');
        } finally {
            this.hideLoading('stopSessionBtn');
        }
    }

    handleSessionUpdate(data) {
        this.updateSessionUI(data.active);
        if (!data.active && data.session) {
            // Session ended, show summary
            this.showSessionSummary(data.session);
        }
    }

    updateSessionUI(sessionActive) {
        const sessionControls = document.getElementById('sessionControls');
        const sessionStatus = document.getElementById('sessionStatus');
        const startBtn = document.getElementById('startSessionBtn');
        const stopBtn = document.getElementById('stopSessionBtn');

        if (sessionActive) {
            sessionControls.classList.add('session-active');
            sessionStatus.innerHTML = '<i class="fas fa-circle text-success"></i> Session Active';
            startBtn.disabled = true;
            stopBtn.disabled = false;
        } else {
            sessionControls.classList.remove('session-active');
            sessionStatus.innerHTML = '<i class="fas fa-circle text-secondary"></i> No Active Session';
            startBtn.disabled = false;
            stopBtn.disabled = true;
        }
    }

    updateFocusDisplay(data) {
        const focusDisplay = document.getElementById('focusDisplay');
        const currentApp = document.getElementById('currentApp');
        const focusTime = document.getElementById('focusTime');
        const distractionTime = document.getElementById('distractionTime');

        if (data.status === 'focused') {
            focusDisplay.className = 'focus-status focused';
            currentApp.textContent = data.app;
            focusTime.textContent = this.formatTime(data.duration);
        } else {
            focusDisplay.className = 'focus-status distracted';
            currentApp.textContent = data.app;
            distractionTime.textContent = this.formatTime(data.duration);
        }
    }

    showApprovalDialog(data) {
        const modal = document.getElementById('approvalModal');
        const message = document.getElementById('approvalMessage');
        const requestId = document.getElementById('approvalRequestId');

        message.textContent = data.message;
        requestId.value = data.requestId;

        this.showModal('approvalModal');
    }

    async handleAppApproval(approved) {
        const requestId = document.getElementById('approvalRequestId').value;
        
        try {
            await ipcRenderer.invoke('handle-app-approval', requestId, approved);
            this.hideModal('approvalModal');
            
            if (approved) {
                this.showNotification('App access granted', 'info');
            } else {
                this.showNotification('App access denied', 'info');
            }
        } catch (error) {
            console.error('Error handling app approval:', error);
            this.showNotification('Error processing approval', 'error');
        }
    }

    showSessionSummary(summary) {
        const modal = document.getElementById('sessionSummaryModal');
        const content = document.getElementById('sessionSummaryContent');

        const distractionDetails = summary.distractionDetails.map(detail => 
            `<li>${this.escapeHtml(detail.appName)}: ${this.formatTime(detail.timeSpent)}</li>`
        ).join('');

        content.innerHTML = `
            <div class="summary-section">
                <h4>Session Overview</h4>
                <p><strong>Session:</strong> ${this.escapeHtml(summary.sessionName)}</p>
                <p><strong>Duration:</strong> ${this.formatTime(summary.totalDuration)}</p>
                <p><strong>Productivity Score:</strong> ${summary.productivity}%</p>
            </div>
            
            <div class="summary-section">
                <h4>Time Breakdown</h4>
                <p><strong>Focused Time:</strong> ${this.formatTime(summary.focusedTime)}</p>
                <p><strong>Distracted Time:</strong> ${this.formatTime(summary.distractedTime)}</p>
                <p><strong>Blocked Attempts:</strong> ${summary.blockedCount}</p>
            </div>
            
            <div class="summary-section">
                <h4>Distraction Details</h4>
                ${distractionDetails ? `<ul>${distractionDetails}</ul>` : '<p>No distractions recorded</p>'}
            </div>
            
            <div class="summary-section">
                <h4>Selected Apps</h4>
                <p>${summary.selectedApps.map(app => this.escapeHtml(app)).join(', ')}</p>
            </div>
        `;

        this.showModal('sessionSummaryModal');
    }

    // Modal management
    showModal(modalId) {
        document.getElementById(modalId).style.display = 'block';
    }

    hideModal(modalId) {
        document.getElementById(modalId).style.display = 'none';
    }

    showAddManualAppModal() {
        this.showModal('addManualAppModal');
    }

    showUploadAppModal() {
        this.showModal('uploadAppModal');
    }

    showPackageManagerModal() {
        this.showModal('packageManagerModal');
    }

    async handleManualAppSubmit(e) {
        e.preventDefault();
        
        const appName = document.getElementById('manualAppName').value;
        const category = document.getElementById('manualAppCategory').value;

        if (!appName.trim()) {
            this.showNotification('Please enter an app name', 'warning');
            return;
        }

        try {
            await this.addAppToCategory(appName.trim(), category);
            document.getElementById('manualAppForm').reset();
            this.hideModal('addManualAppModal');
        } catch (error) {
            console.error('Error adding manual app:', error);
        }
    }

    async searchApps(query) {
        if (!query.trim()) {
            this.displayDetectedApps(this.detectedApps);
            return;
        }

        try {
            const result = await ipcRenderer.invoke('search-apps', query);
            if (result.success) {
                this.displayDetectedApps(result.apps);
            }
        } catch (error) {
            console.error('Error searching apps:', error);
        }
    }

    async clearAllData() {
        if (!confirm('Are you sure you want to clear all data? This cannot be undone.')) {
            return;
        }

        try {
            const result = await ipcRenderer.invoke('clear-all-data');
            
            if (result.success) {
                this.selectedApps.clear();
                this.allowedApps.clear();
                this.blockedApps.clear();
                this.sessionStats = [];
                this.updateUI();
                this.showNotification('All data cleared successfully', 'success');
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('Error clearing data:', error);
            this.showNotification(`Failed to clear data: ${error.message}`, 'error');
        }
    }

    async exportData() {
        try {
            const data = {
                selectedApps: Array.from(this.selectedApps),
                allowedApps: Array.from(this.allowedApps),
                blockedApps: Array.from(this.blockedApps),
                sessionStats: this.sessionStats
            };

            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `focus-app-data-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            this.showNotification('Data exported successfully', 'success');
        } catch (error) {
            console.error('Error exporting data:', error);
            this.showNotification('Failed to export data', 'error');
        }
    }

    // Utility methods
    showSection(sectionId) {
        document.querySelectorAll('.section').forEach(section => {
            section.classList.remove('active');
        });
        document.getElementById(sectionId).classList.add('active');
    }

    showLoading(buttonId, text = 'Loading...') {
        const button = document.getElementById(buttonId);
        const originalText = button.innerHTML;
        button.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${text}`;
        button.disabled = true;
        button.dataset.originalText = originalText;
    }

    hideLoading(buttonId) {
        const button = document.getElementById(buttonId);
        if (button.dataset.originalText) {
            button.innerHTML = button.dataset.originalText;
            button.disabled = false;
        }
    }

    showNotification(message, type = 'info') {
        const notification = document.getElementById('notification');
        notification.textContent = message;
        notification.className = `notification ${type} show`;
        
        setTimeout(() => {
            notification.classList.remove('show');
        }, 3000);
    }

    formatTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        if (hours > 0) {
            return `${hours}h ${minutes}m ${secs}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${secs}s`;
        } else {
            return `${secs}s`;
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.focusApp = new FocusAppRenderer();
});