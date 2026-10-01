const { exec, execFile, spawn } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');

const execPromise = util.promisify(exec);
const execFilePromise = util.promisify(execFile);

// Path to compiled C# Win32 helper executable
const HELPER_EXE_PATH = path.join(__dirname, 'windowHelper.exe');

// Known process mapping for common applications
const KNOWN_PROCESS_MAP = {
    'google chrome': ['chrome'],
    'chrome': ['chrome'],
    'microsoft edge': ['msedge'],
    'edge': ['msedge'],
    'mozilla firefox': ['firefox'],
    'firefox': ['firefox'],
    'brave': ['brave'],
    'opera': ['opera', 'launcher'],
    'microsoft word': ['winword'],
    'word': ['winword'],
    'microsoft excel': ['excel'],
    'excel': ['excel'],
    'microsoft powerpoint': ['powerpnt'],
    'powerpoint': ['powerpnt'],
    'microsoft outlook': ['outlook'],
    'outlook': ['outlook'],
    'microsoft onenote': ['onenote', 'onenotem'],
    'onenote': ['onenote', 'onenotem'],
    'microsoft teams': ['teams', 'ms-teams'],
    'teams': ['teams', 'ms-teams'],
    'microsoft access': ['msaccess'],
    'access': ['msaccess'],
    'visual studio code': ['code'],
    'vs code': ['code'],
    'code': ['code'],
    'visual studio': ['devenv'],
    'notepad': ['notepad'],
    'calculator': ['calc', 'calculatorapp', 'calculator'],
    'paint': ['mspaint'],
    'command prompt': ['cmd'],
    'powershell': ['powershell', 'pwsh'],
    'windows terminal': ['windowsterminal'],
    'spotify': ['spotify'],
    'discord': ['discord'],
    'slack': ['slack'],
    'vlc': ['vlc'],
    'telegram': ['telegram'],
    'whatsapp': ['whatsapp', 'whatsapp.root'],
    'zoom': ['zoom']
};

class NativeWindowsHelper {
    static getKnownProcessNames(appName) {
        if (!appName) return [];
        const clean = appName.toLowerCase().replace(/\.exe$/i, '').trim();
        const names = new Set();
        names.add(clean);

        if (KNOWN_PROCESS_MAP[clean]) {
            for (const alias of KNOWN_PROCESS_MAP[clean]) {
                names.add(alias);
            }
        }

        // Substring / partial match on known keys
        for (const [key, aliases] of Object.entries(KNOWN_PROCESS_MAP)) {
            if (clean.includes(key) || key.includes(clean)) {
                for (const a of aliases) names.add(a);
            }
        }

        return Array.from(names);
    }

    static async getForegroundWindow() {
        if (process.platform !== 'win32') {
            return null;
        }

        // 1. Try compiled Win32 C# helper first (fastest ~15ms)
        if (fs.existsSync(HELPER_EXE_PATH)) {
            try {
                const { stdout } = await execFilePromise(HELPER_EXE_PATH, ['get-active'], { timeout: 1500 });
                if (stdout && stdout.trim()) {
                    const parsed = JSON.parse(stdout.trim());
                    if (parsed && (parsed.processName || parsed.windowTitle)) {
                        return {
                            name: parsed.processName || '',
                            title: parsed.windowTitle || '',
                            path: parsed.path || '',
                            pid: parsed.pid || 0
                        };
                    }
                }
            } catch (e) {
                // Fallback below
            }
        }

        // 2. Fast PowerShell fallback using safe Base64 command
        try {
            const script = `
$w = Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId); [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder s, int m);' -Name "W" -Namespace "U" -PassThru -ErrorAction SilentlyContinue
$h = [U.W]::GetForegroundWindow()
if ($h -ne [IntPtr]::Zero) {
    $p = 0; [U.W]::GetWindowThreadProcessId($h, [ref]$p)
    $proc = Get-Process -Id $p -ErrorAction SilentlyContinue
    $sb = New-Object System.Text.StringBuilder 256
    [U.W]::GetWindowText($h, $sb, 256) | Out-Null
    @{ processName = if ($proc) { $proc.ProcessName } else { "" }; windowTitle = $sb.ToString(); pid = $p } | ConvertTo-Json -Compress
} else { "{}" }
`;
            const encoded = Buffer.from(script, 'utf16le').toString('base64');
            const { stdout } = await execFilePromise('powershell.exe', [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy', 'Bypass',
                '-EncodedCommand', encoded
            ], { timeout: 2000 });

            if (stdout && stdout.trim()) {
                const parsed = JSON.parse(stdout.trim());
                if (parsed && (parsed.processName || parsed.windowTitle)) {
                    return {
                        name: parsed.processName || '',
                        title: parsed.windowTitle || '',
                        path: '',
                        pid: parsed.pid || 0
                    };
                }
            }
        } catch (e) {}

        return null;
    }

    static async getRunningProcesses() {
        if (process.platform !== 'win32') return [];
        try {
            const { stdout } = await execFilePromise('tasklist.exe', ['/FO', 'CSV', '/NH', '/V'], { timeout: 2000 });
            const lines = stdout.split('\r\n');
            const procs = [];

            for (const line of lines) {
                if (!line.trim()) continue;
                // Parse CSV line: "Image Name","PID","Session Name","Session#","Mem Usage","Status","User Name","CPU Time","Window Title"
                const parts = line.split('","').map(p => p.replace(/^"|"$/g, '').trim());
                if (parts.length >= 2) {
                    const image = parts[0];
                    const pid = parseInt(parts[1], 10) || 0;
                    const title = parts.length >= 9 ? parts[8] : '';
                    const baseName = image.replace(/\.exe$/i, '').toLowerCase();

                    procs.push({
                        image: image,
                        name: baseName,
                        pid: pid,
                        title: title
                    });
                }
            }
            return procs;
        } catch (e) {
            return [];
        }
    }

    static async activateApp(appNameOrProcess) {
        if (process.platform !== 'win32') return false;
        if (!appNameOrProcess) return false;

        const aliases = this.getKnownProcessNames(appNameOrProcess);

        // 1. Try helper first
        if (fs.existsSync(HELPER_EXE_PATH)) {
            for (const alias of aliases) {
                try {
                    const { stdout } = await execFilePromise(HELPER_EXE_PATH, ['activate', alias], { timeout: 1500 });
                    if (stdout && stdout.trim() === 'true') {
                        return true;
                    }
                } catch (e) {}
            }
        }

        // 2. PowerShell activation fallback
        for (const alias of aliases) {
            try {
                const clean = alias.replace(/[^a-zA-Z0-9_\-]/g, '');
                if (!clean) continue;
                const psCode = `
$w = Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);' -Name "Act" -Namespace "U" -PassThru -ErrorAction SilentlyContinue
$procs = Get-Process | Where-Object { ($_.ProcessName -like "*${clean}*" -or $_.MainWindowTitle -like "*${clean}*") -and $_.MainWindowHandle -ne [IntPtr]::Zero }
foreach ($p in $procs) {
    [U.Act]::ShowWindow($p.MainWindowHandle, 9)
    [U.Act]::SetForegroundWindow($p.MainWindowHandle)
}
`;
                const encoded = Buffer.from(psCode, 'utf16le').toString('base64');
                await execFilePromise('powershell.exe', [
                    '-NoProfile',
                    '-NonInteractive',
                    '-ExecutionPolicy', 'Bypass',
                    '-EncodedCommand', encoded
                ], { timeout: 2000 });
            } catch (e) {}
        }

        return true;
    }

    static async isProcessRunning(appNameOrProcess, runningProcs = null) {
        if (process.platform !== 'win32') return false;
        if (!appNameOrProcess) return false;

        const aliases = this.getKnownProcessNames(appNameOrProcess);
        const procs = runningProcs || await this.getRunningProcesses();

        for (const proc of procs) {
            const procLower = proc.name.toLowerCase();
            const titleLower = (proc.title || '').toLowerCase();

            for (const alias of aliases) {
                const aliasLower = alias.toLowerCase();
                if (procLower === aliasLower ||
                    procLower.includes(aliasLower) ||
                    aliasLower.includes(procLower) ||
                    (titleLower && titleLower.includes(aliasLower))) {
                    return true;
                }
            }
        }

        return false;
    }

    static async killProcess(appNameOrProcess) {
        if (process.platform !== 'win32') return false;
        if (!appNameOrProcess) return false;

        const aliases = this.getKnownProcessNames(appNameOrProcess);
        let killedAny = false;

        // 1. Get running processes list to find matching PIDs and Image Names
        const runningProcs = await this.getRunningProcesses();
        const pidsToKill = new Set();
        const imagesToKill = new Set();

        const protectedNames = new Set([
            'electron', 'locked-in', 'locked-in focus app', 'antigravity ide',
            'explorer', 'csrss', 'smss', 'services', 'lsass', 'winlogon', 'dwm',
            'svchost', 'taskhostw', 'sihost', 'system', 'idle', 'runtimebroker',
            'shellexperiencehost', 'searchapp', 'textinputhost', 'cmd', 'powershell',
            'conhost', 'node'
        ]);

        for (const proc of runningProcs) {
            if (protectedNames.has(proc.name)) continue;

            const procLower = proc.name.toLowerCase();
            const titleLower = (proc.title || '').toLowerCase();

            for (const alias of aliases) {
                const aliasLower = alias.toLowerCase();
                if (procLower === aliasLower ||
                    procLower.includes(aliasLower) ||
                    aliasLower.includes(procLower) ||
                    (titleLower && titleLower.includes(aliasLower))) {
                    if (proc.pid > 0) pidsToKill.add(proc.pid);
                    if (proc.image) imagesToKill.add(proc.image);
                    break;
                }
            }
        }

        // Kill by PID
        for (const pid of pidsToKill) {
            try {
                await execPromise(`taskkill /F /PID ${pid} /T`, { timeout: 2000 }).catch(() => {});
                killedAny = true;
            } catch (e) {}
        }

        // Kill by image name
        for (const image of imagesToKill) {
            try {
                await execPromise(`taskkill /F /IM "${image}" /T`, { timeout: 2000 }).catch(() => {});
                killedAny = true;
            } catch (e) {}
        }

        // Direct fallback on alias image names
        for (const alias of aliases) {
            if (!protectedNames.has(alias)) {
                try {
                    await execPromise(`taskkill /F /IM "${alias}.exe" /T`, { timeout: 1500 }).catch(() => {});
                } catch (e) {}
            }
        }

        return killedAny;
    }

    static async launchApp(appNameOrPath) {
        try {
            if (!appNameOrPath || typeof appNameOrPath !== 'string') return false;

            if (process.platform === 'win32') {
                // If it's a full path or file that exists on disk
                if (fs.existsSync(appNameOrPath)) {
                    spawn('cmd.exe', ['/c', 'start', '""', appNameOrPath], {
                        detached: true,
                        stdio: 'ignore'
                    }).unref();
                    return true;
                }

                // Check common system32 tools (e.g. notepad, calc, cmd, powershell)
                const baseName = appNameOrPath.replace(/\.exe$/i, '');
                const system32Path = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', `${baseName}.exe`);
                if (fs.existsSync(system32Path)) {
                    spawn('cmd.exe', ['/c', 'start', '""', system32Path], {
                        detached: true,
                        stdio: 'ignore'
                    }).unref();
                    return true;
                }

                // Check if command is in PATH
                try {
                    const { stdout } = await execPromise(`where.exe "${appNameOrPath}"`, { timeout: 1500 });
                    if (stdout && stdout.trim()) {
                        const verifiedPath = stdout.trim().split('\r\n')[0].trim();
                        spawn('cmd.exe', ['/c', 'start', '""', verifiedPath], {
                            detached: true,
                            stdio: 'ignore'
                        }).unref();
                        return true;
                    }
                } catch (e) {
                    // Not in PATH
                }

                console.warn(`[LaunchApp] Executable or path not found: ${appNameOrPath}`);
                return false;
            } else if (process.platform === 'darwin') {
                spawn('open', ['-a', appNameOrPath], { detached: true, stdio: 'ignore' }).unref();
                return true;
            } else {
                spawn(appNameOrPath, [], { detached: true, stdio: 'ignore' }).unref();
                return true;
            }
        } catch (e) {
            console.warn(`Error launching app ${appNameOrPath}:`, e.message);
            return false;
        }
    }
}

module.exports = NativeWindowsHelper;
