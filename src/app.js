document.addEventListener('DOMContentLoaded', function() {
    // Initialize variables
    let allowedApps = [];
    let blockedApps = [];
    let isSessionActive = false;
    let installedApps = [];
    let customApps = [];
    let currentSettings = {
        darkMode: false,
        duration: 25,
        notifications: true,
        autoStart: false
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
        showLoadingState(true);
        
        try {
            // Load settings
            currentSettings = await window.electronAPI.getSettings();
            applySettings();

            // Load app lists
            const [savedAllowedApps, savedBlockedApps, appData, savedCustomApps] = await Promise.all([
                window.electronAPI.getAllowedApps(),
                window.electronAPI.getBlockedApps(),
                window.electronAPI.getInstalledApps(),
                window.electronAPI.getCustomApps()
            ]);
            
            allowedApps = savedAllowedApps || [];
            blockedApps = savedBlockedApps || [];
            installedApps = appData.all || appData || [];
            customApps = savedCustomApps || [];
            
            console.log(`Loaded ${installedApps.length} installed apps and ${customApps.length} custom apps`);
            
            renderAppLists();
            initializeHelpSystem();
        } catch (error) {
            console.error('Failed to initialize app:', error);
            showNotification('Failed to initialize application. Please restart.', 'error');
        } finally {
            showLoadingState(false);
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

    function showLoadingState(isLoading) {
        const elements = [addAllowedAppBtn, addBlockedAppBtn, startSessionBtn];
        elements.forEach(btn => {
            btn.disabled = isLoading;
            btn.style.opacity = isLoading ? '0.6' : '1';
        });
    }

    // Apply current settings to UI
    function applySettings() {
        if (currentSettings.darkMode) {
            document.body.classList.add('light-mode');
            darkModeToggle.checked = true;
        } else {
            document.body.classList.remove('light-mode');
            darkModeToggle.checked = false;
        }

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
        if (newDuration >= 1 && newDuration <= 480) { // Max 8 hours
            currentSettings.duration = newDuration;
            saveSettings();
        } else {
            durationInput.value = currentSettings.duration;
            showNotification('Duration must be between 1 and 480 minutes (8 hours)');
        }
    }

    // Save settings to storage
    async function saveSettings() {
        try {
            const result = await window.electronAPI.saveSettings(currentSettings);
            if (!result.success) {
                throw new Error(result.error || 'Failed to save settings');
            }
        } catch (error) {
            console.error('Failed to save settings:', error);
            showNotification('Failed to save settings', 'error');
        }
    }

    // Enhanced app selection with categories and search
    async function showAppSelection(listType) {
        try {
            showLoadingState(true);
            
            // Get all available apps
            const allApps = [...installedApps, ...customApps];
            
            // Create enhanced modal
            const modal = document.createElement('div');
            modal.className = 'app-selection-modal';
            modal.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0, 0, 0, 0.8); display: flex; justify-content: center;
                align-items: center; z-index: 1000; animation: fadeIn 0.3s ease;
            `;
            
            const modalContent = document.createElement('div');
            modalContent.style.cssText = `
                background: var(--bg-color, #1a1a2e); padding: 30px; border-radius: 15px;
                width: 600px; max-height: 80vh; overflow-y: auto; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
                color: var(--text-color, #e6e6e6);
            `;
            
            // Title
            const title = document.createElement('h3');
            title.textContent = `Select Applications to ${listType === 'allowed' ? 'Focus On' : 'Block'}`;
            title.style.cssText = 'margin-bottom: 20px; color: #64ffda; text-align: center; font-size: 1.3em;';
            
            // Search input
            const searchContainer = document.createElement('div');
            searchContainer.style.cssText = 'margin-bottom: 20px; position: relative;';
            
            const searchInput = document.createElement('input');
            searchInput.type = 'text';
            searchInput.placeholder = 'Search applications...';
            searchInput.style.cssText = `
                width: 100%; padding: 12px 40px 12px 15px; border: 1px solid rgba(100, 255, 218, 0.3);
                border-radius: 8px; background: rgba(255, 255, 255, 0.1); color: #e6e6e6;
                font-size: 14px; outline: none;
            `;
            
            const searchIcon = document.createElement('div');
            searchIcon.innerHTML = '🔍';
            searchIcon.style.cssText = `
                position: absolute; right: 15px; top: 50%; transform: translateY(-50%);
                pointer-events: none; opacity: 0.7;
            `;
            
            searchContainer.appendChild(searchInput);
            searchContainer.appendChild(searchIcon);
            
            // Add custom app section
            const customAppSection = document.createElement('div');
            customAppSection.style.cssText = 'margin-bottom: 20px; padding: 15px; background: rgba(100, 255, 218, 0.1); border-radius: 8px;';
            
            const customAppTitle = document.createElement('h4');
            customAppTitle.textContent = 'Add Custom Application';
            customAppTitle.style.cssText = 'margin-bottom: 10px; color: #64ffda;';
            
            const customAppContainer = document.createElement('div');
            customAppContainer.style.cssText = 'display: flex; gap: 10px;';
            
            const customAppInput = document.createElement('input');
            customAppInput.type = 'text';
            customAppInput.placeholder = 'Enter app name...';
            customAppInput.style.cssText = `
                flex: 1; padding: 8px 12px; border: 1px solid rgba(255, 255, 255, 0.2);
                border-radius: 5px; background: rgba(255, 255, 255, 0.05); color: #e6e6e6;
            `;
            
            const addCustomBtn = document.createElement('button');
            addCustomBtn.textContent = 'Add';
            addCustomBtn.style.cssText = `
                padding: 8px 15px; background: #64ffda; color: #1a1a2e; border: none;
                border-radius: 5px; cursor: pointer; font-weight: bold;
            `;
            
            customAppContainer.appendChild(customAppInput);
            customAppContainer.appendChild(addCustomBtn);
            customAppSection.appendChild(customAppTitle);
            customAppSection.appendChild(customAppContainer);
            
            // Apps container
            const appsContainer = document.createElement('div');
            appsContainer.style.cssText = `
                max-height: 400px; overflow-y: auto; border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px; padding: 15px;
            `;
            
            // Category filter
            const categoryFilter = document.createElement('div');
            categoryFilter.style.cssText = 'margin-bottom: 15px; display: flex; flex-wrap: wrap; gap: 8px;';
            
            const categories = ['All', 'browser', 'development', 'communication', 'entertainment', 'creative', 'system', 'other'];
            let activeCategory = 'All';
            
            categories.forEach(category => {
                const categoryBtn = document.createElement('button');
                categoryBtn.textContent = category.charAt(0).toUpperCase() + category.slice(1);
                categoryBtn.style.cssText = `
                    padding: 5px 12px; border: 1px solid rgba(100, 255, 218, 0.3); border-radius: 15px;
                    background: ${category === activeCategory ? '#64ffda' : 'transparent'};
                    color: ${category === activeCategory ? '#1a1a2e' : '#64ffda'};
                    cursor: pointer; font-size: 12px; transition: all 0.3s ease;
                `;
                
                categoryBtn.addEventListener('click', () => {
                    activeCategory = category;
                    updateCategoryStyles();
                    filterAndDisplayApps();
                });
                
                categoryFilter.appendChild(categoryBtn);
            });
            
            function updateCategoryStyles() {
                Array.from(categoryFilter.children).forEach(btn => {
                    const isActive = btn.textContent.toLowerCase() === activeCategory.toLowerCase();
                    btn.style.background = isActive ? '#64ffda' : 'transparent';
                    btn.style.color = isActive ? '#1a1a2e' : '#64ffda';
                });
            }
            
            // App list container
            const appList = document.createElement('div');
            appList.style.cssText = 'display: grid; gap: 8px;';
            
            // Function to filter and display apps
            function filterAndDisplayApps() {
                const searchTerm = searchInput.value.toLowerCase();
                appList.innerHTML = '';
                
                let filteredApps = allApps.filter(app => {
                    const matchesSearch = app.name.toLowerCase().includes(searchTerm);
                    const matchesCategory = activeCategory === 'All' || app.type === activeCategory;
                    return matchesSearch && matchesCategory;
                });
                
                // Sort apps alphabetically
                filteredApps.sort((a, b) => a.name.localeCompare(b.name));
                
                if (filteredApps.length === 0) {
                    const noResults = document.createElement('div');
                    noResults.textContent = 'No applications found';
                    noResults.style.cssText = 'text-align: center; padding: 20px; color: #888; font-style: italic;';
                    appList.appendChild(noResults);
                    return;
                }
                
                filteredApps.forEach(app => {
                    const appItem = document.createElement('div');
                    appItem.style.cssText = `
                        display: flex; align-items: center; padding: 12px; background: rgba(255, 255, 255, 0.05);
                        border-radius: 8px; cursor: pointer; transition: all 0.3s ease;
                        border: 1px solid transparent;
                    `;
                    
                    appItem.addEventListener('mouseenter', () => {
                        appItem.style.background = 'rgba(100, 255, 218, 0.1)';
                        appItem.style.borderColor = 'rgba(100, 255, 218, 0.3)';
                    });
                    
                    appItem.addEventListener('mouseleave', () => {
                        appItem.style.background = 'rgba(255, 255, 255, 0.05)';
                        appItem.style.borderColor = 'transparent';
                    });
                    
                    const appNameSpan = document.createElement('span');
                    appNameSpan.textContent = app.name;
                    appNameSpan.style.cssText = 'flex: 1; font-weight: 500;';
                    
                    const appTypeSpan = document.createElement('span');
                    appTypeSpan.textContent = app.type.charAt(0).toUpperCase() + app.type.slice(1);
                    appTypeSpan.style.cssText = 'font-size: 12px; opacity: 0.7; margin-left: auto;';
                    
                    appItem.appendChild(appNameSpan);
                    appItem.appendChild(appTypeSpan);
                    
                    appItem.addEventListener('click', () => {
                        addToList(app.name, listType);
                        modal.remove();
                    });
                    
                    appList.appendChild(appItem);
                });
            }
            
            // Initial display
            filterAndDisplayApps();
            
            // Search event
            searchInput.addEventListener('input', filterAndDisplayApps);
            
            // Add custom app
            addCustomBtn.addEventListener('click', async () => {
                const appName = customAppInput.value.trim();
                if (!appName) {
                    showNotification('Please enter an app name', 'warning');
                    return;
                }
                
                try {
                    const result = await window.electronAPI.addCustomApp(appName);
                    if (result.success) {
                        customApps.push(result.app);
                        addToList(appName, listType);
                        showNotification('Custom app added successfully', 'success');
                        customAppInput.value = '';
                        filterAndDisplayApps();
                    } else {
                        showNotification(result.error || 'Failed to add custom app', 'error');
                    }
                } catch (error) {
                    showNotification('Failed to add custom app', 'error');
                }
            });
            
            // Close modal
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.style.animation = 'fadeOut 0.3s ease';
                    setTimeout(() => modal.remove(), 300);
                }
            });
            
            // Assemble modal
            appsContainer.appendChild(categoryFilter);
            appsContainer.appendChild(appList);
            
            modalContent.appendChild(title);
            modalContent.appendChild(searchContainer);
            modalContent.appendChild(customAppSection);
            modalContent.appendChild(appsContainer);
            modal.appendChild(modalContent);
            document.body.appendChild(modal);
        } catch (error) {
            console.error('Failed to show app selection:', error);
            showNotification('Failed to load applications', 'error');
        } finally {
            showLoadingState(false);
        }
    }

    // Add app to allowed or blocked list
    function addToList(appName, listType) {
        if (listType === 'allowed') {
            if (!allowedApps.includes(appName)) {
                allowedApps.push(appName);
                window.electronAPI.allowApplication(appName);
                renderAppLists();
                showNotification(`${appName} added to focus list`, 'success');
            } else {
                showNotification(`${appName} is already in focus list`, 'warning');
            }
        } else {
            if (!blockedApps.includes(appName)) {
                blockedApps.push(appName);
                window.electronAPI.blockApplication(appName);
                renderAppLists();
                showNotification(`${appName} added to block list`, 'success');
            } else {
                showNotification(`${appName} is already in block list`, 'warning');
            }
        }
    }

    // Remove app from list
    function removeFromList(appName, listType) {
        if (listType === 'allowed') {
            allowedApps = allowedApps.filter(app => app !== appName);
            window.electronAPI.disallowApplication(appName);
        } else {
            blockedApps = blockedApps.filter(app => app !== appName);
            window.electronAPI.unblockApplication(appName);
        }
        renderAppLists();
        showNotification(`${appName} removed from ${listType} list`, 'success');
    }

    // Render allowed and blocked lists
    function renderAppLists() {
        allowedList.innerHTML = '';
        blockedList.innerHTML = '';

        allowedApps.forEach(app => {
            allowedList.appendChild(createAppListItem(app, 'allowed'));
        });

        blockedApps.forEach(app => {
            blockedList.appendChild(createAppListItem(app, 'blocked'));
        });
    }

    // Create app list item
    function createAppListItem(appName, listType) {
        const item = document.createElement('li');
        item.className = 'app-item';
        item.style.cssText = `
            display: flex; align-items: center; padding: 10px; margin: 5px 0;
            background: rgba(255, 255, 255, 0.05); border-radius: 8px;
            transition: all 0.3s ease;
        `;
        
        const nameSpan = document.createElement('span');
        nameSpan.textContent = appName;
        nameSpan.style.flex = '1';
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.innerHTML = '×';
        deleteBtn.style.cssText = `
            background: none; border: none; color: #ff6b6b; cursor: pointer;
            font-size: 18px; width: 24px; height: 24px; display: flex;
            align-items: center; justify-content: center; transition: all 0.3s ease;
        `;
        
        deleteBtn.addEventListener('click', () => removeFromList(appName, listType));
        
        const moveBtn = document.createElement('button');
        moveBtn.className = 'move-btn';
        moveBtn.textContent = listType === 'allowed' ? 'Block' : 'Allow';
        moveBtn.style.cssText = `
            padding: 4px 8px; margin-left: 10px; border-radius: 4px;
            background: ${listType === 'allowed' ? '#ff6b6b' : '#4caf50'};
            color: white; border: none; cursor: pointer; font-size: 12px;
            transition: all 0.3s ease;
        `;
        
        moveBtn.addEventListener('click', () => {
            removeFromList(appName, listType);
            addToList(appName, listType === 'allowed' ? 'blocked' : 'allowed');
        });
        
        item.appendChild(nameSpan);
        item.appendChild(moveBtn);
        item.appendChild(deleteBtn);
        
        return item;
    }

    // Start focus session
    async function startFocusSession() {
        if (isSessionActive) return;
        
        const duration = parseInt(durationInput.value);
        
        if (allowedApps.length === 0) {
            showNotification('Please select at least one app to focus on', 'warning');
            return;
        }
        
        showLoadingState(true);
        
        try {
            const result = await window.electronAPI.startFocusSession(duration, allowedApps, blockedApps);
            if (result.success) {
                isSessionActive = true;
                startSessionBtn.disabled = true;
                stopSessionBtn.disabled = false;
                document.body.classList.add('session-active');
                showNotification('Focus session started!', 'success');
                
                // Start timer display if needed
                updateSessionTimer(result.session.startTime, duration);
            } else {
                showNotification(result.error || 'Failed to start session', 'error');
            }
        } catch (error) {
            console.error('Failed to start session:', error);
            showNotification('Failed to start focus session', 'error');
        } finally {
            showLoadingState(false);
        }
    }

    // Stop focus session
    async function stopFocusSession() {
        if (!isSessionActive) return;
        
        showLoadingState(true);
        
        try {
            const result = await window.electronAPI.stopFocusSession();
            if (result.success) {
                isSessionActive = false;
                startSessionBtn.disabled = false;
                stopSessionBtn.disabled = true;
                document.body.classList.remove('session-active');
                showNotification('Focus session stopped', 'success');
                
                // Clear timer
                if (sessionTimer) clearInterval(sessionTimer);
            } else {
                showNotification(result.error || 'Failed to stop session', 'error');
            }
        } catch (error) {
            console.error('Failed to stop session:', error);
            showNotification('Failed to stop focus session', 'error');
        } finally {
            showLoadingState(false);
        }
    }

    // Update session timer display
    let sessionTimer;
    function updateSessionTimer(startTime, duration) {
        const timerElement = document.getElementById('sessionTimer');
        if (!timerElement) return;
        
        sessionTimer = setInterval(() => {
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            const remaining = duration * 60 - elapsed;
            
            if (remaining <= 0) {
                clearInterval(sessionTimer);
                timerElement.textContent = '00:00';
                return;
            }
            
            const minutes = Math.floor(remaining / 60).toString().padStart(2, '0');
            const seconds = (remaining % 60).toString().padStart(2, '0');
            timerElement.textContent = `${minutes}:${seconds}`;
        }, 1000);
    }

    // Show app attempt notification
    let currentAppAttempt = null;
    function showAppNotification(appName, isBlocked) {
        currentAppAttempt = appName;
        
        notificationTitle.textContent = isBlocked ? 'Blocked Application Attempt' : 'Non-Focus App Attempt';
        notificationMessage.textContent = isBlocked 
            ? `Attempt to open ${appName}. This app is in your block list. Opening it will break your focus.`
            : `Attempt to open ${appName}. This app isn't in your focus list. Are you sure?`;
        
        notificationCancel.textContent = 'Stay Focused';
        notificationConfirm.textContent = 'Open Anyway';
        
        notificationModal.style.display = 'flex';
        notificationModal.style.animation = 'modalSlideIn 0.3s ease';
        
        // Focus on modal for accessibility
        notificationCancel.focus();
    }

    // Close notification modal
    function closeNotification() {
        notificationModal.style.animation = 'modalSlideOut 0.3s ease';
        setTimeout(() => {
            notificationModal.style.display = 'none';
        }, 300);
        
        if (currentAppAttempt) {
            window.electronAPI.appChoiceResult(false, currentAppAttempt);
            currentAppAttempt = null;
        }
    }

    // Confirm open app
    function confirmAppOpen() {
        if (currentAppAttempt) {
            window.electronAPI.appChoiceResult(true, currentAppAttempt);
            currentAppAttempt = null;
        }
        closeNotification();
    }

    // Show session report
    function showSessionReport(data) {
        const totalTime = Math.round(data.totalTime / 60000);
        const focusedTime = Math.round(data.focusedTime / 60000);
        const distractedTime = Math.round(data.distractedTime / 60000);
        const productivity = Math.round((data.focusedTime / data.totalTime) * 100) || 0;
        
        document.getElementById('totalTime').textContent = `${totalTime} min`;
        document.getElementById('focusedTime').textContent = `${focusedTime} min`;
        document.getElementById('distractedTime').textContent = `${distractedTime} min`;
        document.getElementById('blockedAttempts').textContent = data.blockedAttempts;
        document.getElementById('productivityScore').textContent = `${productivity}%`;
        
        // Add motivational message
        const messageElement = document.getElementById('motivationalMessage') || document.createElement('p');
        messageElement.id = 'motivationalMessage';
        let message;
        if (productivity > 90) {
            message = 'Excellent focus! You\'re a productivity master!';
        } else if (productivity > 70) {
            message = 'Great job! Keep building that focus muscle.';
        } else if (productivity > 50) {
            message = 'Good effort! Try to minimize distractions next time.';
        } else {
            message = 'Room for improvement. You\'ve got this next time!';
        }
        const reportStats = document.getElementById('reportStats');
        messageElement.style.cssText = `
            text-align: center; margin: 20px 0; padding: 10px;
            background: rgba(100, 255, 218, 0.1); border-radius: 10px;
            font-weight: 500; line-height: 1.4;
        `;
        reportStats.parentNode.insertBefore(messageElement, reportStats.nextSibling);
        messageElement.textContent = message;
        
        sessionReportModal.style.display = 'flex';
        sessionReportModal.style.animation = 'modalSlideIn 0.3s ease';
        
        // Play completion sound
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            // Play a pleasant completion melody
            const frequencies = [523.25, 659.25, 783.99]; // C5, E5, G5
            frequencies.forEach((freq, index) => {
                setTimeout(() => {
                    const osc = audioContext.createOscillator();
                    const gain = audioContext.createGain();
                    
                    osc.connect(gain);
                    gain.connect(audioContext.destination);
                    
                    osc.frequency.setValueAtTime(freq, audioContext.currentTime);
                    gain.gain.setValueAtTime(0, audioContext.currentTime);
                    gain.gain.linearRampToValueAtTime(0.1, audioContext.currentTime + 0.01);
                    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.4);
                    
                    osc.start(audioContext.currentTime);
                    osc.stop(audioContext.currentTime + 0.4);
                }, index * 200);
            });
        } catch (e) {
            // Silently fail if audio context not supported
        }
    }

    // Close session report
    function closeSessionReport() {
        sessionReportModal.style.animation = 'modalSlideOut 0.3s ease';
        setTimeout(() => {
            sessionReportModal.style.display = 'none';
        }, 300);
    }

    // Show a notification to the user
    function showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; padding: 15px 20px;
            border-radius: 8px; z-index: 10000; max-width: 350px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3); font-weight: 500;
            animation: slideInRight 0.3s ease; backdrop-filter: blur(10px);
        `;
        
        // Style based on type
        if (type === 'success') {
            notification.style.background = 'rgba(76, 175, 80, 0.9)';
            notification.style.color = 'white';
            notification.style.border = '1px solid rgba(76, 175, 80, 0.3)';
        } else if (type === 'error') {
            notification.style.background = 'rgba(244, 67, 54, 0.9)';
            notification.style.color = 'white';
            notification.style.border = '1px solid rgba(244, 67, 54, 0.3)';
        } else if (type === 'warning') {
            notification.style.background = 'rgba(255, 193, 7, 0.9)';
            notification.style.color = '#1a1a2e';
            notification.style.border = '1px solid rgba(255, 193, 7, 0.3)';
        } else {
            notification.style.background = 'rgba(33, 150, 243, 0.9)';
            notification.style.color = 'white';
            notification.style.border = '1px solid rgba(33, 150, 243, 0.3)';
        }
        
        // Add icon based on type
        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };
        
        notification.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 18px;">${icons[type] || icons.info}</span>
                <span>${message}</span>
            </div>
        `;
        
        // Add close button
        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '×';
        closeBtn.style.cssText = `
            position: absolute; top: 5px; right: 8px; background: transparent;
            border: none; color: currentColor; cursor: pointer; font-size: 18px;
            width: 20px; height: 20px; display: flex; align-items: center;
            justify-content: center; opacity: 0.7; transition: opacity 0.3s ease;
        `;
        
        closeBtn.addEventListener('click', () => {
            notification.style.animation = 'slideOutRight 0.3s ease';
            setTimeout(() => {
                if (document.body.contains(notification)) {
                    document.body.removeChild(notification);
                }
            }, 300);
        });
        
        closeBtn.addEventListener('mouseenter', () => {
            closeBtn.style.opacity = '1';
        });
        
        closeBtn.addEventListener('mouseleave', () => {
            closeBtn.style.opacity = '0.7';
        });
        
        notification.appendChild(closeBtn);
        document.body.appendChild(notification);
        
        // Auto remove after duration based on type
        const duration = type === 'error' ? 8000 : (type === 'success' ? 4000 : 6000);
        setTimeout(() => {
            if (document.body.contains(notification)) {
                notification.style.animation = 'slideOutRight 0.3s ease';
                setTimeout(() => {
                    if (document.body.contains(notification)) {
                        document.body.removeChild(notification);
                    }
                }, 300);
            }
        }, duration);
        
        // Stack notifications
        const existingNotifications = document.querySelectorAll('.notification');
        if (existingNotifications.length > 1) {
            const offset = (existingNotifications.length - 1) * 80;
            notification.style.bottom = `${20 + offset}px`;
        }
    }

    // Initialize tooltips and help system
    function initializeHelpSystem() {
        const helpButton = document.createElement('button');
        helpButton.className = 'help-btn';
        helpButton.innerHTML = '?';
        helpButton.style.cssText = `
            position: fixed; top: 20px; right: 20px; width: 40px; height: 40px;
            background: #64ffda; color: #1a1a2e; border: none; border-radius: 50%;
            font-size: 20px; font-weight: bold; cursor: pointer; z-index: 1000;
            display: flex; align-items: center; justify-content: center;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3); transition: all 0.3s ease;
        `;
        
        helpButton.addEventListener('click', showHelpModal);
        helpButton.addEventListener('mouseenter', () => {
            helpButton.style.transform = 'scale(1.1)';
        });
        helpButton.addEventListener('mouseleave', () => {
            helpButton.style.transform = 'scale(1)';
        });
        
        document.body.appendChild(helpButton);

        // Add tooltips to key elements
        const tooltipElements = [
            { element: darkModeToggle, text: 'Toggle between dark and light theme' },
            { element: durationInput, text: 'Set the duration of your focus session (1-480 minutes)' },
            { element: addAllowedAppBtn, text: 'Add applications you want to focus on' },
            { element: addBlockedAppBtn, text: 'Add applications to block during focus sessions' },
            { element: startSessionBtn, text: 'Start a new focus session' },
            { element: stopSessionBtn, text: 'Stop the current focus session' }
        ];

        tooltipElements.forEach(({ element, text }) => {
            const tooltip = document.createElement('span');
            tooltip.className = 'tooltip';
            tooltip.textContent = text;
            tooltip.style.cssText = `
                visibility: hidden; position: absolute; background: rgba(0, 0, 0, 0.8);
                color: white; padding: 8px 12px; border-radius: 6px; font-size: 12px;
                z-index: 1000; width: max-content; max-width: 200px; text-align: center;
                transform: translateY(-10px); opacity: 0; transition: all 0.3s ease;
            `;
            
            element.style.position = 'relative';
            element.appendChild(tooltip);
            
            element.addEventListener('mouseenter', () => {
                tooltip.style.visibility = 'visible';
                tooltip.style.opacity = '1';
                tooltip.style.transform = 'translateY(0)';
            });
            
            element.addEventListener('mouseleave', () => {
                tooltip.style.visibility = 'hidden';
                tooltip.style.opacity = '0';
                tooltip.style.transform = 'translateY(-10px)';
            });
        });
    }

    // Show help modal
    function showHelpModal() {
        const modal = document.createElement('div');
        modal.className = 'help-modal';
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.8); display: flex; justify-content: center;
            align-items: center; z-index: 1000; animation: fadeIn 0.3s ease;
        `;
        
        const modalContent = document.createElement('div');
        modalContent.style.cssText = `
            background: var(--bg-color, #1a1a2e); padding: 30px; border-radius: 15px;
            width: 500px; max-height: 80vh; overflow-y: auto; color: var(--text-color, #e6e6e6);
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
        `;
        
        modalContent.innerHTML = `
            <h3 style="margin-bottom: 20px; color: #64ffda; text-align: center;">How to Use Locked In</h3>
            <p style="margin-bottom: 15px;">Locked In helps you stay focused by managing your application usage during focus sessions.</p>
            <ul style="list-style: disc; padding-left: 20px; margin-bottom: 20px;">
                <li><strong>Add Apps:</strong> Use the "+" buttons to add apps to your focus or block lists.</li>
                <li><strong>Start Session:</strong> Set a duration and click "Start Focus" to begin.</li>
                <li><strong>Manage Apps:</strong> During a session, non-allowed apps will be minimized or closed.</li>
                <li><strong>Session Report:</strong> View productivity stats when a session ends.</li>
                <li><strong>Shortcuts:</strong> Use Ctrl+Shift+S to start/stop sessions, Esc to close modals.</li>
            </ul>
            <button id="closeHelp" style="
                display: block; margin: 0 auto; padding: 10px 20px; background: #64ffda;
                color: #1a1a2e; border: none; border-radius: 5px; cursor: pointer; font-weight: bold;
            ">Close</button>
        `;
        
        modal.appendChild(modalContent);
        document.body.appendChild(modal);
        
        const closeHelp = modalContent.querySelector('#closeHelp');
        closeHelp.addEventListener('click', () => {
            modal.style.animation = 'fadeOut 0.3s ease';
            setTimeout(() => modal.remove(), 300);
        });
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.animation = 'fadeOut 0.3s ease';
                setTimeout(() => modal.remove(), 300);
            }
        });
    }

    // Clean up event listeners when window is closed
    window.addEventListener('beforeunload', () => {
        if (sessionTimer) {
            clearInterval(sessionTimer);
        }
        
        window.electronAPI.removeAllListeners('app-attempt');
        window.electronAPI.removeAllListeners('session-end');
        window.electronAPI.removeAllListeners('error');
    });

    // Handle keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ctrl/Cmd + Shift + S to start/stop session
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
            e.preventDefault();
            if (isSessionActive) {
                stopFocusSession();
            } else {
                startFocusSession();
            }
        }
        
        // Escape to close modals
        if (e.key === 'Escape') {
            if (notificationModal.style.display === 'flex') {
                closeNotification();
            } else if (sessionReportModal.style.display === 'flex') {
                closeSessionReport();
            } else {
                const helpModal = document.querySelector('.help-modal');
                if (helpModal) {
                    helpModal.style.animation = 'fadeOut 0.3s ease';
                    setTimeout(() => helpModal.remove(), 300);
                }
            }
        }
        
        // Enter to confirm in notification modal
        if (e.key === 'Enter' && notificationModal.style.display === 'flex') {
            confirmAppOpen();
        }
    });

    // Add CSS animations
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateX(-20px);
            }
            to {
                opacity: 1;
                transform: translateX(0);
            }
        }
        
        @keyframes fadeOut {
            from {
                opacity: 1;
                transform: scale(1);
            }
            to {
                opacity: 0;
                transform: scale(0.9);
            }
        }
        
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        
        @keyframes slideInRight {
            from {
                opacity: 0;
                transform: translateX(100%);
            }
            to {
                opacity: 1;
                transform: translateX(0);
            }
        }
        
        @keyframes slideOutRight {
            from {
                opacity: 1;
                transform: translateX(0);
            }
            to {
                opacity: 0;
                transform: translateX(100%);
            }
        }
        
        @keyframes modalSlideIn {
            from {
                opacity: 0;
                transform: scale(0.9) translateY(-20px);
            }
            to {
                opacity: 1;
                transform: scale(1) translateY(0);
            }
        }
        
        @keyframes modalSlideOut {
            from {
                opacity: 1;
                transform: scale(1) translateY(0);
            }
            to {
                opacity: 0;
                transform: scale(0.9) translateY(-20px);
            }
        }
        
        .app-selection-modal, .help-modal {
            animation: fadeIn 0.3s ease;
        }
        
        .notification {
            transition: all 0.3s ease;
        }
        
        .notification:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
        }
        
        .app-item {
            transition: all 0.3s ease;
        }
        
        .app-item:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        }
        
        .move-btn:hover,
        .delete-btn:hover,
        .help-btn:hover {
            transform: scale(1.1);
        }
        
        .session-active .primary-btn {
            background: linear-gradient(45deg, #4caf50, #45a049) !important;
            animation: pulse 2s infinite;
        }
        
        @keyframes pulse {
            0% { box-shadow: 0 4px 15px rgba(76, 175, 80, 0.3); }
            50% { box-shadow: 0 4px 25px rgba(76, 175, 80, 0.6); }
            100% { box-shadow: 0 4px 15px rgba(76, 175, 80, 0.3); }
        }
        
        /* Enhanced scrollbar styling */
        *::-webkit-scrollbar {
            width: 8px;
            height: 8px;
        }
        
        *::-webkit-scrollbar-track {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 4px;
        }
        
        *::-webkit-scrollbar-thumb {
            background: rgba(100, 255, 218, 0.6);
            border-radius: 4px;
        }
        
        *::-webkit-scrollbar-thumb:hover {
            background: rgba(100, 255, 218, 0.8);
        }
        
        /* Responsive improvements */
        @media (max-width: 768px) {
            .notification {
                right: 10px;
                left: 10px;
                max-width: none;
            }
            
            .app-selection-modal > div, .help-modal > div {
                width: 90vw !important;
                margin: 20px;
            }
        }
        
        /* Focus indicators for accessibility */
        button:focus,
        input:focus {
            outline: 2px solid #64ffda;
            outline-offset: 2px;
        }
        
        /* Loading state styles */
        .loading {
            opacity: 0.6;
            pointer-events: none;
        }
        
        .loading::after {
            content: '';
            position: absolute;
            width: 16px;
            height: 16px;
            margin: auto;
            border: 2px solid #64ffda;
            border-top: 2px solid transparent;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);
});