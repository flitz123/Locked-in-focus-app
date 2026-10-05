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

        // 1. Try compiled Win32 C# helper first (fastest ~5ms)
        if (fs.existsSync(HELPER_EXE_PATH)) {
            try {
                const { stdout } = await execFilePromise(HELPER_EXE_PATH, ['get-active'], { timeout: 1200 });
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

        // 2. PowerShell fallback
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

        // 1. Try helper first (takes <5ms)
        if (fs.existsSync(HELPER_EXE_PATH)) {
            try {
                const { stdout } = await execFilePromise(HELPER_EXE_PATH, ['get-running'], { timeout: 1500 });
                if (stdout && stdout.trim()) {
                    const parsed = JSON.parse(stdout.trim());
                    if (Array.isArray(parsed)) {
                        return parsed.map(p => ({
                            name: (p.name || '').toLowerCase().replace(/\.exe$/i, ''),
                            image: `${p.name}.exe`,
                            pid: p.pid || 0,
                            title: p.title || ''
                        }));
                    }
                }
            } catch (e) {}
        }

        // 2. Fallback to tasklist
        try {
            const { stdout } = await execFilePromise('tasklist.exe', ['/FO', 'CSV', '/NH'], { timeout: 2500 });
            const lines = stdout.split('\r\n');
            const procs = [];

            for (const line of lines) {
                if (!line.trim()) continue;
                const parts = line.split('","').map(p => p.replace(/^"|"$/g, '').trim());
                if (parts.length >= 2) {
                    const image = parts[0];
                    const pid = parseInt(parts[1], 10) || 0;
                    const baseName = image.replace(/\.exe$/i, '').toLowerCase();

                    procs.push({
                        image: image,
                        name: baseName,
                        pid: pid,
                        title: ''
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

        // 1. Try C# helper first with AttachThreadInput + SetForegroundWindow
        if (fs.existsSync(HELPER_EXE_PATH)) {
            for (const alias of aliases) {
                try {
                    const { stdout } = await execFilePromise(HELPER_EXE_PATH, ['activate', alias], { timeout: 1200 });
                    if (stdout && stdout.trim() === 'true') {
                        return true;
                    }
                } catch (e) {}
            }
        }

        return false;
    }

    static async isProcessRunning(appNameOrProcess, runningProcs = null) {
        if (process.platform !== 'win32') return false;
        if (!appNameOrProcess) return false;

        const aliases = this.getKnownProcessNames(appNameOrProcess);

        // If runningProcs list is already provided, check against it instantly
        if (runningProcs && Array.isArray(runningProcs)) {
            for (const proc of runningProcs) {
                const procLower = (proc.name || '').toLowerCase();
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

        // Fast check via helper
        if (fs.existsSync(HELPER_EXE_PATH)) {
            for (const alias of aliases) {
                try {
                    const { stdout } = await execFilePromise(HELPER_EXE_PATH, ['is-running', alias], { timeout: 1200 });
                    if (stdout && stdout.trim() === 'true') {
                        return true;
                    }
                } catch (e) {}
            }
        }

        return false;
    }

    static async killProcess(appNameOrProcess) {
        if (process.platform !== 'win32') return false;
        if (!appNameOrProcess) return false;

        const aliases = this.getKnownProcessNames(appNameOrProcess);
        let killedAny = false;

        // 1. Use C# helper (instant termination without spawning taskkill/cmd)
        if (fs.existsSync(HELPER_EXE_PATH)) {
            for (const alias of aliases) {
                try {
                    const { stdout } = await execFilePromise(HELPER_EXE_PATH, ['kill', alias], { timeout: 1500 });
                    if (stdout && parseInt(stdout.trim(), 10) > 0) {
                        killedAny = true;
                    }
                } catch (e) {}
            }
        }

        // 2. Fallback: taskkill for any lingering processes
        if (!killedAny) {
            const protectedNames = new Set([
                'electron', 'locked-in', 'locked-in focus app', 'antigravity ide',
                'explorer', 'csrss', 'smss', 'services', 'lsass', 'winlogon', 'dwm',
                'svchost', 'taskhostw', 'sihost', 'system', 'idle', 'runtimebroker',
                'shellexperiencehost', 'searchapp', 'textinputhost', 'cmd', 'powershell',
                'conhost', 'node'
            ]);

            for (const alias of aliases) {
                if (!protectedNames.has(alias)) {
                    try {
                        await execPromise(`taskkill /F /IM "${alias}.exe" /T`, { timeout: 1000 }).catch(() => {});
                    } catch (e) {}
                }
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
                    const { stdout } = await execPromise(`where.exe "${appNameOrPath}"`, { timeout: 1200 });
                    if (stdout && stdout.trim()) {
                        const verifiedPath = stdout.trim().split('\r\n')[0].trim();
                        spawn('cmd.exe', ['/c', 'start', '""', verifiedPath], {
                            detached: true,
                            stdio: 'ignore'
                        }).unref();
                        return true;
                    }
                } catch (e) {}

                // Try running with start directly
                spawn('cmd.exe', ['/c', 'start', '""', appNameOrPath], {
                    detached: true,
                    stdio: 'ignore'
                }).unref();
                return true;
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
