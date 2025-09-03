document.addEventListener('DOMContentLoaded', function() {
    // Initialize variables
    let allowedApps = [];
    let blockedApps = [];
    let isSessionActive = false;
    let currentSettings = {
        darkMode: false,
        duration: 25
    };

    // DOM Elements
    const darkModeToggle = document.getElementById('darkModeToggle');
    const durationInput = document.getElementById('duration');
    const allowedList = document.getElementById('allowedList');
    const blockedList = document.getElementById('blockedList');
    const addAllowedAppBtn = document.getElementById('addAllowedApp');
    const addBlockedAppBtn = document.getElementById('addBlockedApp');
    const startSessionBtn = document.getElementById('startSession');
    const stopSessionBtn = document.getElementById('stopSession');
    const notificationModal = document.getElementById('notificationModal');
    const notificationTitle = document.getElementById('notificationTitle');
    const notificationMessage = document.getElementById('notificationMessage');
    const notificationCancel = document.getElementById('notificationCancel');
    const notificationConfirm = document.getElementById('notificationConfirm');
    const sessionReportModal = document.getElementById('sessionReportModal');
    const closeReport = document.getElementById('closeReport');

    // Initialize the application
    initApp();

    // Event Listeners
    darkModeToggle.addEventListener('change', toggleDarkMode);
    durationInput.addEventListener('change', updateDuration);
    addAllowedAppBtn.addEventListener('click', () => showAppSelection('allowed'));
    addBlockedAppBtn.addEventListener('click', () => showAppSelection('blocked'));
    startSessionBtn.addEventListener('click', startFocusSession);
    stopSessionBtn.addEventListener('click', stopFocusSession);
    notificationCancel.addEventListener('click', closeNotification);
    notificationConfirm.addEventListener('click', confirmAppOpen);
    closeReport.addEventListener('click', closeSessionReport);

    // Initialize the application
    async function initApp() {
        // Load settings
        try {
            currentSettings = await window.electronAPI.getSettings();
            applySettings();
        } catch (error) {
            console.error('Failed to load settings:', error);
        }

        // Load app lists
        try {
            const savedAllowedApps = await window.electronAPI.getAllowedApps();
            const savedBlockedApps = await window.electronAPI.getBlockedApps();
            
            allowedApps = savedAllowedApps || [];
            blockedApps = savedBlockedApps || [];
            
            renderAppLists();
        } catch (error) {
            console.error('Failed to load app lists:', error);
        }

        // Set up event listeners from main process
        window.electronAPI.onAppAttempt((event, data) => {
            showAppNotification(data.appName, data.isBlocked);
        });

        window.electronAPI.onSessionEnd((event, data) => {
            stopFocusSession();
            showSessionReport(data);
        });

        window.electronAPI.onError((event, error) => {
            showNotification('Application Error: ' + error, 'error');
        });
    }

    // Apply current settings to UI
    function applySettings() {
        // Set dark mode
        if (currentSettings.darkMode) {
            document.body.classList.add('light-mode');
            darkModeToggle.checked = true;
        } else {
            document.body.classList.remove('light-mode');
            darkModeToggle.checked = false;
        }

        // Set duration
        durationInput.value = currentSettings.duration;
    }

    // Toggle dark/light mode
    function toggleDarkMode() {
        currentSettings.darkMode = darkModeToggle.checked;
        document.body.classList.toggle('light-mode', currentSettings.darkMode);
        saveSettings();
    }

    // Update session duration
    function updateDuration() {
        const newDuration = parseInt(durationInput.value);
        if (newDuration >= 1 && newDuration <= 120) {
            currentSettings.duration = newDuration;
            saveSettings();
        } else {
            durationInput.value = currentSettings.duration;
            showNotification('Duration must be between 1 and 120 minutes');
        }
    }

    // Save settings to storage
    async function saveSettings() {
        try {
            await window.electronAPI.saveSettings(currentSettings);
        } catch (error) {
            console.error('Failed to save settings:', error);
            showNotification('Failed to save settings');
        }
    }

    // Show application selection dialog
    async function showAppSelection(listType) {
        try {
            const installedApps = await window.electronAPI.getInstalledApps();
            
            // Create a simple modal for app selection
            const modal = document.createElement('div');
            modal.style.position = 'fixed';
            modal.style.top = '0';
            modal.style.left = '0';
            modal.style.width = '100%';
            modal.style.height = '100%';
            modal.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
            modal.style.display = 'flex';
            modal.style.justifyContent = 'center';
            modal.style.alignItems = 'center';
            modal.style.zIndex = '1000';
            
            const modalContent = document.createElement('div');
            modalContent.style.backgroundColor = '#1a1a2e';
            modalContent.style.padding = '20px';
            modalContent.style.borderRadius = '10px';
            modalContent.style.width = '400px';
            modalContent.style.maxHeight = '80vh';
            modalContent.style.overflowY = 'auto';
            
            const title = document.createElement('h3');
            title.textContent = `Select Applications to ${listType === 'allowed' ? 'Monitor' : 'Block'}`;
            title.style.marginBottom = '15px';
            title.style.color = '#64ffda';
            
            const appList = document.createElement('div');
            appList.style.display = 'flex';
            appList.style.flexDirection = 'column';
            appList.style.gap = '10px';
            
            installedApps.forEach(app => {
                const appItem = document.createElement('div');
                appItem.style.display = 'flex';
                appItem.style.alignItems = 'center';
                appItem.style.padding = '8px';
                appItem.style.backgroundColor = '#4a4a6d';
                appItem.style.borderRadius = '5px';
                appItem.style.cursor = 'pointer';
                appItem.addEventListener('click', () => {
                    addAppToList(app.name, listType);
                    document.body.removeChild(modal);
                });
                
                const appIcon = document.createElement('div');
                appIcon.style.width = '20px';
                appIcon.style.height = '20px';
                appIcon.style.backgroundColor = '#64ffda';
                appIcon.style.borderRadius = '4px';
                appIcon.style.marginRight = '10px';
                
                const appName = document.createElement('span');
                appName.textContent = app.name;
                
                appItem.appendChild(appIcon);
                appItem.appendChild(appName);
                appList.appendChild(appItem);
            });
            
            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = 'Cancel';
            cancelBtn.style.marginTop = '15px';
            cancelBtn.style.padding = '8px 15px';
            cancelBtn.style.backgroundColor = '#4a4a6d';
            cancelBtn.style.color = 'white';
            cancelBtn.style.border = 'none';
            cancelBtn.style.borderRadius = '5px';
            cancelBtn.style.cursor = 'pointer';
            cancelBtn.addEventListener('click', () => {
                document.body.removeChild(modal);
            });
            
            modalContent.appendChild(title);
            modalContent.appendChild(appList);
            modalContent.appendChild(cancelBtn);
            modal.appendChild(modalContent);
            document.body.appendChild(modal);
            
        } catch (error) {
            console.error('Failed to get installed apps:', error);
            showNotification('Failed to load applications');
        }
    }

    // Add application to the specified list
    async function addAppToList(appName, listType) {
        try {
            if (listType === 'allowed') {
                // Add to allowed list
                await window.electronAPI.allowApplication(appName);
                if (!allowedApps.includes(appName)) {
                    allowedApps.push(appName);
                }
            } else {
                // Add to blocked list
                await window.electronAPI.blockApplication(appName);
                if (!blockedApps.includes(appName)) {
                    blockedApps.push(appName);
                }
            }
            
            renderAppLists();
        } catch (error) {
            console.error(`Failed to add app to ${listType} list:`, error);
            showNotification(`Failed to add ${appName}`);
        }
    }

    // Remove application from the specified list
    async function removeAppFromList(appName, listType) {
        try {
            if (listType === 'allowed') {
                await window.electronAPI.disallowApplication(appName);
                allowedApps = allowedApps.filter(app => app !== appName);
            } else {
                await window.electronAPI.unblockApplication(appName);
                blockedApps = blockedApps.filter(app => app !== appName);
            }
            
            renderAppLists();
        } catch (error) {
            console.error(`Failed to remove app from ${listType} list:`, error);
            showNotification(`Failed to remove ${appName}`);
        }
    }

    // Render both allowed and blocked application lists
    function renderAppLists() {
        // Clear current lists
        allowedList.innerHTML = '';
        blockedList.innerHTML = '';
        
        // Render allowed apps
        allowedApps.forEach(app => {
            const listItem = createAppListItem(app, 'allowed');
            allowedList.appendChild(listItem);
        });
        
        // Render blocked apps
        blockedApps.forEach(app => {
            const listItem = createAppListItem(app, 'blocked');
            blockedList.appendChild(listItem);
        });
        
        // Show message if lists are empty
        if (allowedApps.length === 0) {
            allowedList.innerHTML = '<li class="empty-message">No applications selected</li>';
        }
        
        if (blockedApps.length === 0) {
            blockedList.innerHTML = '<li class="empty-message">No applications blocked</li>';
        }
    }

    // Create a list item for an application
    function createAppListItem(appName, listType) {
        const listItem = document.createElement('li');
        listItem.className = 'app-item';
        
        const appInfo = document.createElement('div');
        appInfo.className = 'app-name';
        
        const appIcon = document.createElement('div');
        appIcon.className = 'app-icon';
        
        const appNameSpan = document.createElement('span');
        appNameSpan.textContent = appName;
        
        appInfo.appendChild(appIcon);
        appInfo.appendChild(appNameSpan);
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.innerHTML = '&times;';
        deleteBtn.title = `Remove from ${listType} list`;
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeAppFromList(appName, listType);
        });
        
        listItem.appendChild(appInfo);
        listItem.appendChild(deleteBtn);
        
        return listItem;
    }

    // Start a focus session
    async function startFocusSession() {
        const duration = parseInt(durationInput.value);
        
        if (duration < 1 || duration > 120) {
            showNotification('Please set a valid duration between 1 and 120 minutes');
            return;
        }
        
        if (allowedApps.length === 0) {
            showNotification('Please select at least one application to focus on');
            return;
        }
        
        try {
            isSessionActive = true;
            await window.electronAPI.startFocusSession(duration, allowedApps, blockedApps);
            
            // Update UI for active session
            document.body.classList.add('session-active');
            startSessionBtn.disabled = true;
            stopSessionBtn.disabled = false;
            
            showNotification('Focus session started! Tracking your activity.', 'success');
        } catch (error) {
            console.error('Failed to start focus session:', error);
            showNotification('Failed to start focus session');
            isSessionActive = false;
        }
    }

    // Stop the current focus session
    async function stopFocusSession() {
        try {
            await window.electronAPI.stopFocusSession();
            
            // Update UI for ended session
            document.body.classList.remove('session-active');
            startSessionBtn.disabled = false;
            stopSessionBtn.disabled = true;
            
            isSessionActive = false;
        } catch (error) {
            console.error('Failed to stop focus session:', error);
            showNotification('Failed to stop focus session');
        }
    }

    // Show app notification when user tries to open a non-allowed app
    function showAppNotification(appName, isBlocked) {
        if (!isSessionActive) return;
        
        notificationTitle.textContent = isBlocked ? 'Distraction Alert' : 'Focus Reminder';
        notificationMessage.textContent = isBlocked 
            ? `You're trying to open ${appName} which is on your block list. This might distract you from your focus session.` 
            : `You're trying to open ${appName} which is not in your focus list.`;
        
        notificationModal.style.display = 'flex';
        
        // Store the app name for the confirm action
        notificationConfirm.dataset.appName = appName;
    }

    // Close the notification modal
    function closeNotification() {
        notificationModal.style.display = 'none';
        // Notify main process that user chose to stay focused
        window.electronAPI.appChoiceResult(false, notificationConfirm.dataset.appName);
    }

    // Confirm opening the app
    function confirmAppOpen() {
        notificationModal.style.display = 'none';
        // Notify main process that user chose to open the app
        window.electronAPI.appChoiceResult(true, notificationConfirm.dataset.appName);
    }

    // Show session report after session ends
    function showSessionReport(data) {
        const totalMinutes = Math.floor(data.totalTime / 60000);
        const focusedMinutes = Math.floor(data.focusedTime / 60000);
        const distractedMinutes = Math.floor(data.distractedTime / 60000);
        
        document.getElementById('totalTime').textContent = `${totalMinutes} min`;
        document.getElementById('focusedTime').textContent = `${focusedMinutes} min`;
        document.getElementById('distractedTime').textContent = `${distractedMinutes} min`;
        document.getElementById('blockedAttempts').textContent = data.blockedAttempts;
        
        sessionReportModal.style.display = 'flex';
    }

    // Close session report
    function closeSessionReport() {
        sessionReportModal.style.display = 'none';
    }

    // Show a notification to the user
    function showNotification(message, type = 'error') {
        // Create notification element
        const notification = document.createElement('div');
        notification.textContent = message;
        notification.style.position = 'fixed';
        notification.style.bottom = '20px';
        notification.style.right = '20px';
        notification.style.padding = '10px 15px';
        notification.style.borderRadius = '5px';
        notification.style.zIndex = '1000';
        notification.style.maxWidth = '300px';
        
        // Style based on type
        if (type === 'success') {
            notification.style.backgroundColor = '#4caf50';
            notification.style.color = 'white';
        } else if (type === 'info') {
            notification.style.backgroundColor = '#2196f3';
            notification.style.color = 'white';
        } else {
            notification.style.backgroundColor = '#f44336';
            notification.style.color = 'white';
        }
        
        document.body.appendChild(notification);
        
        // Remove after 3 seconds
        setTimeout(() => {
            if (document.body.contains(notification)) {
                document.body.removeChild(notification);
            }
        }, 3000);
    }

    // Clean up event listeners when window is closed
    window.addEventListener('beforeunload', () => {
        window.electronAPI.removeAllListeners('app-attempt');
        window.electronAPI.removeAllListeners('session-end');
        window.electronAPI.removeAllListeners('error');
    });
});