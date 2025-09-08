const { ipcRenderer } = require('electron');

// DOM elements
const startSessionBtn = document.getElementById('startSessionBtn');
const stopSessionBtn = document.getElementById('stopSessionBtn');
const sessionSettings = document.getElementById('sessionSettings');
const sessionActive = document.getElementById('sessionActive');
const sessionStats = document.getElementById('sessionStats');
const allowedAppsList = document.getElementById('allowedAppsList');
const blockedAppsList = document.getElementById('blockedAppsList');
const sessionDuration = document.getElementById('sessionDuration');
const appSearch = document.getElementById('appSearch');
const searchResults = document.getElementById('searchResults');
const installedAppsList = document.getElementById('installedAppsList');
const runningProcessesList = document.getElementById('runningProcessesList');

// State
let currentSession = null;
let installedApps = [];
let runningProcesses = [];

// Initialize
document.addEventListener('DOMContentLoaded', init);

async function init() {
  loadInstalledApps();
  loadRunningProcesses();
  setupEventListeners();
  setupIpcListeners();
}

function setupEventListeners() {
  // Session controls
  startSessionBtn.addEventListener('click', startSession);
  stopSessionBtn.addEventListener('click', stopSession);
  
  // App search
  appSearch.addEventListener('input', handleAppSearch);
  
  // App list management
  installedAppsList.addEventListener('click', handleAppSelection);
  runningProcessesList.addEventListener('click', handleAppSelection);
  searchResults.addEventListener('click', handleAppSelection);
  
  // Drag and drop for app lists
  setupDragAndDrop();
}

function setupIpcListeners() {
  // Session events
  ipcRenderer.on('session-started', (event, session) => {
    currentSession = session;
    updateSessionUI(true);
  });
  
  ipcRenderer.on('session-end', (event, stats) => {
    currentSession = null;
    updateSessionUI(false);
    showSessionSummary(stats);
  });
  
  ipcRenderer.on('app-attempt', (event, data) => {
    showAppWarning(data.appName, data.isBlocked);
  });
  
  ipcRenderer.on('app-choice-processed', (event, data) => {
    // Handle user choice result if needed
  });
}

async function loadInstalledApps() {
  try {
    installedApps = await ipcRenderer.invoke('get-installed-apps');
    renderInstalledApps();
  } catch (error) {
    console.error('Failed to load installed apps:', error);
  }
}

async function loadRunningProcesses() {
  try {
    runningProcesses = await ipcRenderer.invoke('get-running-processes');
    renderRunningProcesses();
  } catch (error) {
    console.error('Failed to load running processes:', error);
  }
}

function renderInstalledApps() {
  installedAppsList.innerHTML = installedApps
    .map(app => `
      <div class="app-item" data-name="${app.name}" data-type="installed">
        <span class="app-name">${app.name}</span>
        <span class="app-type">${app.type || 'unknown'}</span>
      </div>
    `)
    .join('');
}

function renderRunningProcesses() {
  runningProcessesList.innerHTML = runningProcesses
    .map(process => `
      <div class="app-item" data-name="${process.name}" data-type="process">
        <span class="app-name">${process.name}</span>
        <span class="app-pid">PID: ${process.pid}</span>
      </div>
    `)
    .join('');
}

function handleAppSearch(event) {
  const query = event.target.value.toLowerCase();
  if (query.length < 2) {
    searchResults.innerHTML = '';
    return;
  }
  
  const filteredApps = installedApps.filter(app => 
    app.name.toLowerCase().includes(query)
  );
  
  searchResults.innerHTML = filteredApps
    .map(app => `
      <div class="app-item" data-name="${app.name}" data-type="installed">
        <span class="app-name">${app.name}</span>
        <span class="app-type">${app.type || 'unknown'}</span>
      </div>
    `)
    .join('');
}

function handleAppSelection(event) {
  const appItem = event.target.closest('.app-item');
  if (!appItem) return;
  
  const appName = appItem.dataset.name;
  const listId = appItem.closest('.app-list').id;
  
  if (listId === 'installedAppsList' || listId === 'searchResults') {
    addToAllowedApps(appName);
  } else if (listId === 'runningProcessesList') {
    addToBlockedApps(appName);
  }
}

function addToAllowedApps(appName) {
  if (!isAppInList(appName, allowedAppsList)) {
    const item = createAppListItem(appName, 'allowed');
    allowedAppsList.appendChild(item);
  }
}

function addToBlockedApps(appName) {
  if (!isAppInList(appName, blockedAppsList)) {
    const item = createAppListItem(appName, 'blocked');
    blockedAppsList.appendChild(item);
  }
}

function isAppInList(appName, listElement) {
  return Array.from(listElement.querySelectorAll('.app-item'))
    .some(item => item.dataset.name === appName);
}

function createAppListItem(appName, type) {
  const item = document.createElement('div');
  item.className = 'app-item';
  item.dataset.name = appName;
  item.innerHTML = `
    <span class="app-name">${appName}</span>
    <button class="remove-btn" data-type="${type}">×</button>
  `;
  
  item.querySelector('.remove-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    item.remove();
  });
  
  return item;
}

function setupDragAndDrop() {
  // Setup drag and drop functionality for app lists
  // This would allow rearranging apps in the allowed/blocked lists
}

async function startSession() {
  const duration = parseInt(sessionDuration.value) || 25;
  const allowedApps = getAllowedApps();
  const blockedApps = getBlockedApps();
  
  if (allowedApps.length === 0) {
    alert('Please select at least one allowed application');
    return;
  }
  
  try {
    const session = await ipcRenderer.invoke('start-session', {
      duration,
      allowedApps,
      blockedApps
    });
    
    currentSession = session;
    updateSessionUI(true);
  } catch (error) {
    console.error('Failed to start session:', error);
    alert('Error starting session: ' + error.message);
  }
}

async function stopSession() {
  try {
    const session = await ipcRenderer.invoke('stop-session');
    currentSession = null;
    updateSessionUI(false);
  } catch (error) {
    console.error('Failed to stop session:', error);
    alert('Error stopping session: ' + error.message);
  }
}

function getAllowedApps() {
  return Array.from(allowedAppsList.querySelectorAll('.app-item'))
    .map(item => item.dataset.name);
}

function getBlockedApps() {
  return Array.from(blockedAppsList.querySelectorAll('.app-item'))
    .map(item => item.dataset.name);
}

function updateSessionUI(isActive) {
  if (isActive) {
    sessionSettings.classList.add('hidden');
    sessionActive.classList.remove('hidden');
    startSessionBtn.disabled = true;
    stopSessionBtn.disabled = false;
  } else {
    sessionSettings.classList.remove('hidden');
    sessionActive.classList.add('hidden');
    startSessionBtn.disabled = false;
    stopSessionBtn.disabled = true;
  }
}

function showSessionSummary(stats) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content">
      <h2>Session Summary</h2>
      <div class="stats">
        <p>Total Time: ${formatTime(stats.totalTime)}</p>
        <p>Focused Time: ${formatTime(stats.focusedTime)}</p>
        <p>Distracted Time: ${formatTime(stats.distractedTime)}</p>
        <p>Blocked Attempts: ${stats.blockedAttempts}</p>
        ${stats.userOpenedApps.length > 0 ? `
          <p>Apps Opened Despite Warnings:</p>
          <ul>
            ${stats.userOpenedApps.map(app => `
              <li>${app.appName}: ${formatTime(app.timeSpent)} (opened ${app.openCount} times)</li>
            `).join('')}
          </ul>
        ` : ''}
      </div>
      <button id="closeSummary">Close</button>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  modal.querySelector('#closeSummary').addEventListener('click', () => {
    modal.remove();
  });
}

function showAppWarning(appName, isBlocked) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content">
      <h2>${isBlocked ? 'Blocked App' : 'Non-Focus App'} Detected</h2>
      <p>You're trying to use <strong>${appName}</strong> which is ${isBlocked ? 'blocked' : 'not in your focus list'}.</p>
      <p>Would you like to allow it for this session?</p>
      <div class="button-group">
        <button id="allowApp">Allow This Time</button>
        <button id="blockApp">Stay Focused</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  modal.querySelector('#allowApp').addEventListener('click', () => {
    ipcRenderer.send('app-choice-result', true, appName);
    modal.remove();
  });
  
  modal.querySelector('#blockApp').addEventListener('click', () => {
    ipcRenderer.send('app-choice-result', false, appName);
    modal.remove();
  });
}

function formatTime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    init,
    startSession,
    stopSession,
    getAllowedApps,
    getBlockedApps
  };
}