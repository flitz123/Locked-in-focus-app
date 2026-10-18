const assert = require('node:assert/strict');
const Module = require('node:module');
const os = require('node:os');
const test = require('node:test');

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'electron') {
        return { app: { getPath: () => os.tmpdir() } };
    }
    return originalLoad.call(this, request, parent, isMain);
};

const FocusManager = require('../focusManager');
const NativeWindows = require('../src/nativeWindows');
Module._load = originalLoad;

const nativeMethods = [
    'getRunningProcesses',
    'getForegroundWindow',
    'isProcessRunning',
    'killProcess',
    'killProcessByPid',
    'activateApp'
];
const originalNativeMethods = Object.fromEntries(
    nativeMethods.map(method => [method, NativeWindows[method]])
);

let foregroundApplication;
let terminatedPids;
let terminatedNames;
let activatedApps;
let windowEvents;
let minimizedWindows;

test.beforeEach(() => {
    foregroundApplication = null;
    terminatedPids = [];
    terminatedNames = [];
    activatedApps = [];
    windowEvents = [];
    minimizedWindows = 0;

    NativeWindows.getRunningProcesses = async () => [];
    NativeWindows.getForegroundWindow = async () => foregroundApplication;
    NativeWindows.isProcessRunning = async () => false;
    NativeWindows.killProcess = async name => {
        terminatedNames.push(name);
        return true;
    };
    NativeWindows.killProcessByPid = async (pid, protectedPids) => {
        terminatedPids.push({ pid, protectedPids });
        return true;
    };
    NativeWindows.activateApp = async appName => {
        activatedApps.push(appName);
        return true;
    };
});

test.afterEach(() => {
    for (const method of nativeMethods) {
        NativeWindows[method] = originalNativeMethods[method];
    }
});

function createManager(focusMode) {
    const manager = new FocusManager();
    manager.sessionActive = true;
    manager.currentSession = {
        settings: { focusMode, notifications: false }
    };
    manager.selectedApps = new Set(['Notepad']);
    manager.mainWindow = {
        webContents: {
            getOSProcessId: () => 8080,
            send: (channel, data) => windowEvents.push({ channel, data })
        },
        isDestroyed: () => false,
        isMinimized: () => false,
        restore() {},
        show() {},
        focus() {},
        minimize() {
            minimizedWindows++;
        }
    };
    return manager;
}

async function runMonitoringTick(manager) {
    let tick;
    const originalSetInterval = global.setInterval;
    global.setInterval = callback => {
        tick = callback;
        return 1;
    };
    try {
        manager.startMonitoringLoop(500);
    } finally {
        global.setInterval = originalSetInterval;
    }
    await tick();
}

test('aggressive mode never terminates the focus app renderer process', async () => {
    const manager = createManager('aggressive');
    foregroundApplication = {
        name: 'electron',
        title: '',
        pid: 8080
    };

    await runMonitoringTick(manager);

    assert.deepEqual(terminatedPids, []);
    assert.deepEqual(terminatedNames, []);
    assert.equal(manager.focusedTime > 0, true);
    assert.equal(windowEvents.at(-1).data.status, 'focused');
});

test('a missing focus-app window is relaunched when restoring focus', async () => {
    const manager = createManager('moderate');
    const launchedApps = [];
    NativeWindows.activateApp = async () => false;
    manager.openApp = async appName => {
        launchedApps.push(appName);
        return true;
    };

    const restored = await manager.bringSelectedAppsToForeground();

    assert.equal(restored, true);
    assert.deepEqual(launchedApps, ['Notepad']);
});

test('starting a focus session keeps its window alive and minimizes it', async () => {
    const manager = createManager('aggressive');
    manager.sessionActive = false;
    manager.currentSession = null;
    manager.openApp = async () => true;

    const originalSetInterval = global.setInterval;
    global.setInterval = () => 1;
    let result;
    try {
        result = await manager.startSession({
            focusMode: 'aggressive',
            notifications: false
        });
    } finally {
        global.setInterval = originalSetInterval;
    }

    assert.equal(result.success, true);
    assert.equal(manager.sessionActive, true);
    assert.equal(manager.mainWindow.isDestroyed(), false);
    assert.equal(minimizedWindows, 1);
});

test('an unavailable foreground window does not trigger enforcement', async () => {
    const manager = createManager('moderate');

    await runMonitoringTick(manager);

    assert.deepEqual(terminatedPids, []);
    assert.deepEqual(terminatedNames, []);
    assert.equal(manager.pendingApprovals.size, 0);
    assert.equal(windowEvents.some(event => event.channel === 'app-approval-request'), false);
});

test('aggressive mode closes unauthorized foreground apps without showing approval', async () => {
    const manager = createManager('aggressive');
    foregroundApplication = {
        name: 'example',
        title: 'Example Document',
        pid: 5050
    };

    await runMonitoringTick(manager);

    assert.equal(terminatedPids[0].pid, 5050);
    assert.equal(terminatedPids[0].protectedPids.includes(8080), true);
    assert.deepEqual(activatedApps, ['Notepad']);
    assert.equal(manager.pendingApprovals.size, 0);
});

test('lenient mode tracks unauthorized apps without terminating them', async () => {
    const manager = createManager('lenient');
    foregroundApplication = {
        name: 'example',
        title: 'Example Document',
        pid: 5050
    };

    await runMonitoringTick(manager);

    assert.deepEqual(terminatedPids, []);
    assert.deepEqual(terminatedNames, []);
    assert.equal(manager.distractionApps.has('example'), true);
    assert.equal(manager.pendingApprovals.size, 0);
});

test('moderate approval reopens the executable and returns the app to the background', async () => {
    const manager = createManager('moderate');
    const executablePath = 'C:\\Apps\\Example\\Example.exe';
    let openedTarget;
    manager.openApp = async target => {
        openedTarget = target;
        return true;
    };
    foregroundApplication = {
        name: 'example',
        title: 'Example Document',
        path: executablePath,
        pid: 5050
    };

    await runMonitoringTick(manager);

    assert.equal(terminatedPids[0].pid, 5050);
    const request = Array.from(manager.pendingApprovals.entries())[0];
    assert.ok(request);
    assert.equal(windowEvents.some(event => event.channel === 'app-approval-request'), true);
    const result = await manager.handleAppApprovalResponse(request[0], true);

    assert.equal(result.success, true);
    assert.equal(openedTarget, executablePath);
    assert.equal(manager.temporaryAllowedApps.has('example'), true);
    assert.equal(minimizedWindows, 1);
});

test('declining a moderate-mode approval restores focus and minimizes the app window', async () => {
    const manager = createManager('moderate');
    foregroundApplication = {
        name: 'example',
        title: 'Example Document',
        pid: 5050
    };

    await runMonitoringTick(manager);

    const requestId = Array.from(manager.pendingApprovals.keys())[0];
    const result = await manager.handleAppApprovalResponse(requestId, false);

    assert.equal(result.success, true);
    assert.deepEqual(activatedApps, ['Notepad', 'Notepad']);
    assert.equal(minimizedWindows, 1);
    assert.equal(manager.temporaryAllowedApps.size, 0);
});
