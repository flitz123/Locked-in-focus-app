const { exec, execFile, spawn } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');

const execPromise = util.promisify(exec);
const execFilePromise = util.promisify(execFile);
const GENERIC_PROCESS_ALIASES = new Set(['javaw', 'msedgewebview2', 'dockerd']);

// Path to compiled C# Win32 helper executable
const HELPER_EXE_PATH = path.join(__dirname, 'windowHelper.exe');

// Comprehensive known process mapping for common applications
const KNOWN_PROCESS_MAP = {
    // Browsers
    'google chrome': ['chrome'],
    'chrome': ['chrome'],
    'microsoft edge': ['msedge'],
    'edge': ['msedge'],
    'mozilla firefox': ['firefox'],
    'firefox': ['firefox'],
    'brave': ['brave'],
    'brave browser': ['brave'],
    'opera': ['opera'],
    'opera gx': ['opera'],
    'vivaldi': ['vivaldi'],
    'arc': ['arc'],
    'tor browser': ['tor', 'firefox'],
    'chromium': ['chromium'],
    'sidekick': ['sidekick'],
    'waterfox': ['waterfox'],

    // Microsoft Office & Productivity
    'microsoft word': ['winword'],
    'word': ['winword'],
    'microsoft excel': ['excel'],
    'excel': ['excel'],
    'microsoft powerpoint': ['powerpnt', 'powerpoint'],
    'powerpoint': ['powerpnt'],
    'microsoft outlook': ['outlook', 'olk'],
    'outlook': ['outlook', 'olk'],
    'microsoft onenote': ['onenote', 'onenotem'],
    'onenote': ['onenote', 'onenotem'],
    'microsoft teams': ['teams', 'ms-teams', 'msedgewebview2'],
    'teams': ['teams', 'ms-teams'],
    'microsoft access': ['msaccess'],
    'access': ['msaccess'],
    'microsoft publisher': ['mspub'],
    'publisher': ['mspub'],
    'microsoft visio': ['visio'],
    'visio': ['visio'],
    'microsoft project': ['winproj'],
    'project': ['winproj'],
    'onedrive': ['onedrive'],
    'skype': ['skype'],

    // Developer Tools & IDEs
    'visual studio code': ['code', 'code - insiders'],
    'vs code': ['code'],
    'vscode': ['code'],
    'code': ['code'],
    'cursor': ['cursor'],
    'visual studio': ['devenv'],
    'intellij idea': ['idea64', 'idea'],
    'intellij': ['idea64', 'idea'],
    'pycharm': ['pycharm64', 'pycharm'],
    'pycharm community edition': ['pycharm64', 'pycharm'],
    'pycharm professional': ['pycharm64', 'pycharm'],
    'webstorm': ['webstorm64', 'webstorm'],
    'rider': ['rider64', 'rider'],
    'clion': ['clion64', 'clion'],
    'goland': ['goland64', 'goland'],
    'datagrip': ['datagrip64', 'datagrip'],
    'android studio': ['studio64', 'studio'],
    'eclipse': ['eclipse'],
    'netbeans': ['netbeans', 'netbeans64'],
    'sublime text': ['sublime_text', 'sublime'],
    'sublime': ['sublime_text'],
    'atom': ['atom'],
    'notepad++': ['notepad++'],
    'notepad plus plus': ['notepad++'],
    'postman': ['postman'],
    'insomnia': ['insomnia'],
    'docker': ['docker desktop', 'dockerd'],
    'docker desktop': ['docker desktop', 'dockerd'],
    'gitkraken': ['gitkraken'],
    'github desktop': ['githubdesktop'],
    'sourcetree': ['sourcetree'],
    'dbeaver': ['dbeaver'],
    'tableplus': ['tableplus'],
    'beekeeper studio': ['beekeeper-studio'],
    'mongodb compass': ['mongodbcompass'],
    'wireshark': ['wireshark'],

    // Notes, Project Management & Docs
    'notion': ['notion'],
    'obsidian': ['obsidian'],
    'logseq': ['logseq'],
    'evernote': ['evernote'],
    'joplin': ['joplin'],
    'anytype': ['anytype'],
    'todoist': ['todoist'],
    'ticktick': ['ticktick'],
    'trello': ['trello'],
    'asana': ['asana'],
    'monday': ['monday'],
    'clickup': ['clickup'],
    'miro': ['miro'],
    'figma': ['figma'],
    'canva': ['canva'],

    // Communication & Social
    'slack': ['slack'],
    'discord': ['discord', 'discordptb', 'discordcanary'],
    'telegram': ['telegram'],
    'telegram desktop': ['telegram'],
    'whatsapp': ['whatsapp', 'whatsapp.root'],
    'zoom': ['zoom'],
    'zoom meetings': ['zoom'],
    'signal': ['signal'],
    'messenger': ['messenger'],
    'wechat': ['wechat'],
    'viber': ['viber'],
    'element': ['element'],

    // Audio, Video & Streaming
    'spotify': ['spotify'],
    'apple music': ['applemusic'],
    'tidal': ['tidal'],
    'vlc': ['vlc'],
    'vlc media player': ['vlc'],
    'windows media player': ['wmplayer'],
    'potplayer': ['potplayer64', 'potplayer'],
    'mpc-hc': ['mpc-hc64', 'mpc-hc'],
    'foobar2000': ['foobar2000'],
    'audacity': ['audacity'],
    'fl studio': ['fl64', 'fl'],
    'ableton live': ['ableton live 11 suite', 'ableton live 12 suite', 'live'],
    'reaper': ['reaper'],
    'obs studio': ['obs64', 'obs32', 'obs'],
    'handbrake': ['handbrake'],
    'davinci resolve': ['resolve'],

    // Creative, 3D & Design
    'adobe photoshop': ['photoshop'],
    'photoshop': ['photoshop'],
    'adobe illustrator': ['illustrator'],
    'illustrator': ['illustrator'],
    'adobe premiere pro': ['premiere'],
    'premiere': ['premiere'],
    'adobe after effects': ['afterfx'],
    'after effects': ['afterfx'],
    'adobe audition': ['audition'],
    'adobe lightroom': ['lightroom'],
    'adobe indesign': ['indesign'],
    'adobe acrobat': ['acrobat', 'acrord32'],
    'acrobat reader': ['acrobat', 'acrord32'],
    'blender': ['blender'],
    'autodesk maya': ['maya'],
    'autodesk 3ds max': ['3dsmax'],
    'autocad': ['acad'],
    'cinema 4d': ['cinema 4d'],
    'zbrush': ['zbrush'],
    'unity': ['unity', 'unity editor'],
    'unreal engine': ['unrealengine', 'unrealeditor'],
    'godot': ['godot', 'godot_engine'],
    'gimp': ['gimp-2.10', 'gimp'],
    'inkscape': ['inkscape'],
    'krita': ['krita'],
    'paint.net': ['paintdotnet'],

    // Games & Gaming Launchers
    'steam': ['steam', 'steamwebhelper'],
    'epic games': ['epicgameslauncher'],
    'epic games launcher': ['epicgameslauncher'],
    'battle.net': ['battle.net'],
    'ea app': ['eadesktop'],
    'origin': ['origin'],
    'ubisoft connect': ['upc', 'ubisoftconnect'],
    'gog galaxy': ['gog galaxy'],
    'riot client': ['riotclientux', 'riotclientservices'],
    'roblox': ['robloxplayerbeta'],
    'minecraft': ['minecraft', 'javaw'],
    'league of legends': ['leagueclient', 'leagueclientux'],
    'valorant': ['valorant'],

    // Windows Built-in Tools
    'notepad': ['notepad'],
    'calculator': ['calc', 'calculatorapp', 'calculator'],
    'paint': ['mspaint'],
    'command prompt': ['cmd'],
    'powershell': ['powershell', 'pwsh'],
    'windows terminal': ['windowsterminal', 'wt'],
    'snipping tool': ['snippingtool', 'screensketch'],
    'task manager': ['taskmgr'],
    'file explorer': ['explorer']
};

class NativeWindowsHelper {
    static getKnownProcessNames(appName) {
        if (!appName) return [];
        const clean = appName.toLowerCase().replace(/\.exe$/i, '').trim();
        const names = new Set();
        names.add(clean);

        // Strip non-alphanumeric (e.g. "Visual Studio Code" -> "visualstudiocode", "Notepad++" -> "notepad")
        const alpha = clean.replace(/[^a-z0-9]/g, '');
        if (alpha && alpha.length > 2) {
            names.add(alpha);
        }

        // Direct key lookup
        if (KNOWN_PROCESS_MAP[clean]) {
            for (const alias of KNOWN_PROCESS_MAP[clean]) {
                names.add(alias);
            }
        }

        // Substring / partial match on known keys
        for (const [key, aliases] of Object.entries(KNOWN_PROCESS_MAP)) {
            if (clean === key || (key.length >= 8 && clean.startsWith(`${key} `))) {
                for (const a of aliases) names.add(a);
            }
            const keyAlpha = key.replace(/[^a-z0-9]/g, '');
            if (keyAlpha.length >= 8 && alpha.startsWith(keyAlpha)) {
                for (const a of aliases) names.add(a);
            }
        }

        // Add first word token (e.g. "Obsidian v1.4" -> "obsidian", "PyCharm Community" -> "pycharm")
        const firstWord = clean.split(/[\s\-_]+/)[0];
        if (firstWord && firstWord.length > 2) {
            names.add(firstWord);
        }

        return Array.from(names);
    }

    static isGenericProcessName(processName) {
        return GENERIC_PROCESS_ALIASES.has((processName || '').toLowerCase());
    }

    static getPreferredProcessNames(appName) {
        const clean = (appName || '').toLowerCase().replace(/\.exe$/i, '').trim();
        const exactAliases = KNOWN_PROCESS_MAP[clean];
        if (exactAliases) return exactAliases;

        for (const [key, aliases] of Object.entries(KNOWN_PROCESS_MAP)) {
            if (key.length >= 8 && clean.startsWith(`${key} `)) return aliases;
        }
        return [];
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
        const preferredAliases = this.getPreferredProcessNames(appNameOrProcess);
        const specificAliases = (preferredAliases.length ? preferredAliases : aliases)
            .filter(alias => !GENERIC_PROCESS_ALIASES.has(alias.toLowerCase()));

        // 1. Try C# helper first with AttachThreadInput + SetForegroundWindow
        if (fs.existsSync(HELPER_EXE_PATH)) {
            for (const alias of specificAliases) {
                try {
                    const { stdout } = await execFilePromise(HELPER_EXE_PATH, ['activate', alias], { timeout: 1200 });
                    if (stdout && stdout.trim() === 'true') {
                        return true;
                    }
                } catch (e) {}
            }

            const genericAliases = aliases.filter(alias => GENERIC_PROCESS_ALIASES.has(alias.toLowerCase()));
            if (genericAliases.length > 0) {
                const runningProcs = await this.getRunningProcesses();
                const hasMatchingWindow = runningProcs.some(proc =>
                    genericAliases.includes((proc.name || '').toLowerCase()) &&
                    this.titleMatchesApp(proc.title || '', appNameOrProcess)
                );
                if (hasMatchingWindow) {
                    try {
                        const { stdout } = await execFilePromise(HELPER_EXE_PATH, ['activate', appNameOrProcess], { timeout: 1200 });
                        if (stdout && stdout.trim() === 'true') return true;
                    } catch (e) {}
                }
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
                const procAlpha = procLower.replace(/[^a-z0-9]/g, '');

                for (const alias of aliases) {
                    const aliasLower = alias.toLowerCase();
                    const aliasAlpha = aliasLower.replace(/[^a-z0-9]/g, '');

                    if (procLower === aliasLower ||
                        (procAlpha && aliasAlpha && procAlpha === aliasAlpha)) {
                        if (GENERIC_PROCESS_ALIASES.has(aliasLower) &&
                            !this.titleMatchesApp(titleLower, appNameOrProcess)) {
                            continue;
                        }
                        return true;
                    }
                }
            }
            return false;
        }

        const genericAliases = aliases.filter(alias => GENERIC_PROCESS_ALIASES.has(alias.toLowerCase()));
        if (genericAliases.length > 0) {
            const runningProcs = await this.getRunningProcesses();
            if (runningProcs.some(proc =>
                genericAliases.includes((proc.name || '').toLowerCase()) &&
                this.titleMatchesApp(proc.title || '', appNameOrProcess)
            )) {
                return true;
            }
        }

        // Fast check via helper
        if (fs.existsSync(HELPER_EXE_PATH)) {
            const processNames = Array.from(new Set([
                ...(this.getPreferredProcessNames(appNameOrProcess).length
                    ? this.getPreferredProcessNames(appNameOrProcess)
                    : aliases)
            ]));
            for (const alias of processNames) {
                if (GENERIC_PROCESS_ALIASES.has(alias.toLowerCase())) continue;
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
        const runningProcs = await this.getRunningProcesses();
        const protectedNames = new Set([
            'electron', 'locked-in', 'locked-in focus app', 'antigravity ide',
            'explorer', 'csrss', 'smss', 'services', 'lsass', 'winlogon', 'dwm',
            'svchost', 'taskhostw', 'sihost', 'system', 'idle', 'runtimebroker',
            'shellexperiencehost', 'searchapp', 'textinputhost', 'conhost', 'node'
        ]);

        for (const alias of aliases) {
            if (protectedNames.has(alias.toLowerCase())) continue;
            try {
                if (GENERIC_PROCESS_ALIASES.has(alias.toLowerCase())) {
                    const matchedPids = runningProcs
                        .filter(proc =>
                            (proc.name || '').toLowerCase() === alias.toLowerCase() &&
                            proc.pid &&
                            this.titleMatchesApp((proc.title || '').toLowerCase(), appNameOrProcess))
                        .map(proc => proc.pid);
                    for (const pid of matchedPids) {
                        await execFilePromise('taskkill.exe', ['/F', '/PID', String(pid), '/T'], { timeout: 1000 });
                        killedAny = true;
                    }
                } else {
                    await execFilePromise('taskkill.exe', ['/F', '/IM', `${alias}.exe`, '/T'], { timeout: 1000 });
                    killedAny = true;
                }
            } catch (e) {
                // The process may have exited between the running-process check and this call.
            }
        }

        return killedAny;
    }

    static titleMatchesApp(title, appName) {
        const normalizedTitle = (title || '').toLowerCase();
        const normalizedName = (appName || '').toLowerCase().replace(/\.exe$/i, '').trim();
        if (normalizedName.length < 3) return false;
        const escapedName = normalizedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[^a-z0-9])${escapedName}([^a-z0-9]|$)`, 'i').test(normalizedTitle);
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
