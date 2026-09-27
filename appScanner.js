const { exec, execFile } = require('child_process');
const util = require('util');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

const execPromise = util.promisify(exec);
const execFilePromise = util.promisify(execFile);

class AppScanner {
    constructor() {
        this.detectedApps = [];
        this.appPathCache = new Map();
        this.categories = {
            office: ['Word', 'Excel', 'PowerPoint', 'Outlook', 'OneNote', 'Teams', 'Access', 'Publisher', 'Visio', 'Project', '365', 'Office'],
            productivity: ['Code', 'Visual Studio', 'Notion', 'Obsidian', 'Slack', 'Discord', 'Zoom', 'Trello', 'Asana', 'Figma', 'Todoist', 'Evernote', 'Git', 'Sublime', 'PyCharm', 'IntelliJ', 'WebStorm', 'Postman', 'Docker', 'Terminal', 'PowerShell', 'Notepad', 'Calculator'],
            pwa: ['PWA', 'Chrome App', 'Edge App', 'Web App', 'Google Docs', 'Google Sheets', 'Google Slides', 'Canva', 'WhatsApp', 'Telegram', 'YouTube Music', 'Linear'],
            browsers: ['Chrome', 'Edge', 'Firefox', 'Brave', 'Opera', 'Vivaldi', 'Safari', 'Chromium', 'Tor Browser'],
            media: ['Spotify', 'VLC', 'Photoshop', 'Illustrator', 'Premiere', 'After Effects', 'Blender', 'Audacity', 'Steam', 'Epic Games', 'GIMP', 'Paint']
        };
    }

    async scanForApps() {
        try {
            const platform = process.platform;
            let apps = [];

            if (platform === 'win32') {
                apps = await this.scanWindowsDeep();
            } else if (platform === 'darwin') {
                apps = await this.scanMacOSApps();
            } else {
                apps = await this.scanLinuxApps();
            }

            // Remove duplicates and sort alphabetically
            apps = this.removeDuplicates(apps);
            apps.sort((a, b) => a.name.localeCompare(b.name));

            this.detectedApps = apps;
            for (const app of apps) {
                if (app.executable || app.path) {
                    this.appPathCache.set(app.name.toLowerCase(), app.executable || app.path);
                }
            }

            return { success: true, count: apps.length, apps: apps };
        } catch (error) {
            console.error('Error scanning for apps:', error);
            return { success: false, error: error.message, apps: this.detectedApps || [] };
        }
    }

    async scanWindowsDeep() {
        const apps = [];
        const seenNames = new Set();

        const addApp = (name, type, executable = '', appPath = '', publisher = '') => {
            if (!name || typeof name !== 'string') return;
            const cleanName = this.cleanAppName(name);
            if (!cleanName || cleanName.length < 2) return;
            
            // Filter out system updates, drivers, runtimes, and junk
            if (/^(KB\d+|Security Update|Hotfix|Update for |Windows Software Development Kit|Microsoft Visual C\+\+ 20\d\d|Microsoft .NET Framework|DirectX|NVIDIA|Intel\(R\)|AMD|Realtek|Synaptics)/i.test(cleanName)) {
                return;
            }

            const lower = cleanName.toLowerCase();
            if (seenNames.has(lower)) return;
            seenNames.add(lower);

            const category = this.categorizeApp(cleanName, type);
            apps.push({
                name: cleanName,
                type: category,
                executable: executable || '',
                path: appPath || executable || '',
                publisher: publisher || 'Installed Application'
            });
        };

        // 1. Scan Microsoft Office Applications (Check real disk paths)
        await this.scanWindowsOffice(addApp);

        // 2. Scan Common Built-in Windows Apps (Only if verified on disk)
        this.scanWindowsBuiltins(addApp);

        // 3. Scan Start Menu Shortcuts (User and All Users)
        try {
            const startMenuPaths = [
                path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
                path.join(process.env.ProgramData || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs')
            ];

            for (const basePath of startMenuPaths) {
                if (fsSync.existsSync(basePath)) {
                    await this.scanShortcutDirectory(basePath, addApp);
                }
            }
        } catch (e) {
            console.warn('Start menu scan warning:', e.message);
        }

        // 4. Scan Registry Uninstall Keys (64-bit, 32-bit, HKCU User)
        const registryKeys = [
            'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
            'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
            'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
        ];

        for (const regKey of registryKeys) {
            try {
                const { stdout } = await execPromise(`reg query "${regKey}" /s`, { maxBuffer: 10 * 1024 * 1024, timeout: 5000 });
                const lines = stdout.split('\r\n');
                let currentApp = {};

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed.startsWith('HKEY_')) {
                        if (currentApp.name && !currentApp.systemComponent && !currentApp.parentKeyName) {
                            addApp(currentApp.name, 'Installed Application', currentApp.exe, currentApp.path, currentApp.publisher);
                        }
                        currentApp = {};
                    } else if (trimmed.startsWith('DisplayName')) {
                        const match = trimmed.match(/DisplayName\s+REG_SZ\s+(.+)/i);
                        if (match) currentApp.name = match[1].trim();
                    } else if (trimmed.startsWith('Publisher')) {
                        const match = trimmed.match(/Publisher\s+REG_SZ\s+(.+)/i);
                        if (match) currentApp.publisher = match[1].trim();
                    } else if (trimmed.startsWith('DisplayIcon')) {
                        const match = trimmed.match(/DisplayIcon\s+REG_SZ\s+(.+)/i);
                        if (match) {
                            const rawIcon = match[1].split(',')[0].trim().replace(/^"|"$/g, '');
                            if (rawIcon.toLowerCase().endsWith('.exe') && fsSync.existsSync(rawIcon)) {
                                currentApp.exe = rawIcon;
                            }
                        }
                    } else if (trimmed.startsWith('InstallLocation')) {
                        const match = trimmed.match(/InstallLocation\s+REG_SZ\s+(.+)/i);
                        if (match) {
                            const loc = match[1].trim().replace(/^"|"$/g, '');
                            if (fsSync.existsSync(loc)) {
                                currentApp.path = loc;
                            }
                        }
                    } else if (trimmed.startsWith('SystemComponent')) {
                        const match = trimmed.match(/SystemComponent\s+REG_DWORD\s+0x1/i);
                        if (match) currentApp.systemComponent = true;
                    } else if (trimmed.startsWith('ParentKeyName')) {
                        currentApp.parentKeyName = true;
                    }
                }
                if (currentApp.name && !currentApp.systemComponent && !currentApp.parentKeyName) {
                    addApp(currentApp.name, 'Installed Application', currentApp.exe, currentApp.path, currentApp.publisher);
                }
            } catch (err) {
                // Ignore key query errors
            }
        }

        // 5. Scan Chrome & Edge Progressive Web Apps (PWAs)
        try {
            const pwaDirs = [
                path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Chrome Apps'),
                path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Edge Apps')
            ];
            for (const pwaDir of pwaDirs) {
                if (fsSync.existsSync(pwaDir)) {
                    const entries = await fs.readdir(pwaDir);
                    for (const entry of entries) {
                        if (entry.toLowerCase().endsWith('.lnk')) {
                            const name = path.basename(entry, path.extname(entry));
                            const lnkPath = path.join(pwaDir, entry);
                            addApp(name, 'Progressive Web App (PWA)', lnkPath, pwaDir, 'PWA');
                        }
                    }
                }
            }
        } catch (e) {
            // Ignore PWA read error
        }

        // 6. Scan Currently Running Processes with Interactive Windows
        try {
            const { stdout } = await execPromise('powershell -NoProfile "Get-Process | Where-Object {$_.MainWindowHandle -ne 0} | Select-Object -Unique ProcessName, MainWindowTitle, Path | ConvertTo-Json -Compress"', { timeout: 3000 });
            if (stdout && stdout.trim()) {
                const procs = JSON.parse(stdout.trim());
                const procList = Array.isArray(procs) ? procs : [procs];
                for (const p of procList) {
                    if (p && p.ProcessName) {
                        const name = p.ProcessName;
                        if (!['electron', 'locked-in', 'explorer', 'shellexperiencehost', 'searchapp', 'systemsettings', 'taskhostw', 'applicationframehost'].includes(name.toLowerCase())) {
                            const titleName = p.MainWindowTitle ? p.MainWindowTitle.split(' - ').pop().trim() : '';
                            const displayName = titleName && titleName.length > 2 && titleName.length < 30 ? titleName : name;
                            addApp(displayName, 'Running Application', p.Path || `${name}.exe`, '', 'Active Application');
                        }
                    }
                }
            }
        } catch (e) {
            // Ignore process list error
        }

        return apps;
    }

    async scanWindowsOffice(addApp) {
        const officeApps = [
            { name: 'Microsoft Word', exe: 'WINWORD.EXE' },
            { name: 'Microsoft Excel', exe: 'EXCEL.EXE' },
            { name: 'Microsoft PowerPoint', exe: 'POWERPNT.EXE' },
            { name: 'Microsoft Outlook', exe: 'OUTLOOK.EXE' },
            { name: 'Microsoft OneNote', exe: 'ONENOTE.EXE' },
            { name: 'Microsoft Access', exe: 'MSACCESS.EXE' },
            { name: 'Microsoft Publisher', exe: 'MSPUB.EXE' },
            { name: 'Microsoft Teams', exe: 'Teams.exe' }
        ];

        const baseRoots = [
            'C:\\Program Files\\Microsoft Office\\root\\Office16',
            'C:\\Program Files (x86)\\Microsoft Office\\root\\Office16',
            'C:\\Program Files\\Microsoft Office\\Office16',
            'C:\\Program Files (x86)\\Microsoft Office\\Office16',
            'C:\\Program Files\\Microsoft Office\\root\\Office15',
            'C:\\Program Files (x86)\\Microsoft Office\\root\\Office15',
            'C:\\Program Files\\Microsoft 365\\Office16',
            path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Teams', 'current'),
            path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps')
        ];

        for (const office of officeApps) {
            for (const root of baseRoots) {
                const target = path.join(root, office.exe);
                if (fsSync.existsSync(target)) {
                    addApp(office.name, 'Microsoft Office & Business', target, root, 'Microsoft Corporation');
                    break;
                }
            }
        }
    }

    scanWindowsBuiltins(addApp) {
        const system32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
        const builtins = [
            { name: 'Notepad', exe: path.join(system32, 'notepad.exe'), type: 'Productivity & Development' },
            { name: 'Calculator', exe: path.join(system32, 'calc.exe'), type: 'Productivity & Development' },
            { name: 'Paint', exe: path.join(system32, 'mspaint.exe'), type: 'Media, Design & Games' },
            { name: 'Command Prompt', exe: path.join(system32, 'cmd.exe'), type: 'Productivity & Development' },
            { name: 'PowerShell', exe: path.join(system32, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), type: 'Productivity & Development' }
        ];

        for (const b of builtins) {
            if (fsSync.existsSync(b.exe)) {
                addApp(b.name, b.type, b.exe, system32, 'Microsoft Windows');
            }
        }
    }

    async scanShortcutDirectory(dir, addApp, depth = 0) {
        if (depth > 4) return;
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    await this.scanShortcutDirectory(fullPath, addApp, depth + 1);
                } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.lnk')) {
                    const rawName = path.basename(entry.name, '.lnk');
                    // Skip uninstallers, help files, readme
                    if (!/uninstall|documentation|help|read me|website|release notes|troubleshoot|diagnostics/i.test(rawName)) {
                        let type = 'Installed Application';
                        if (/word|excel|powerpoint|outlook|onenote|teams|access|publisher|office|visio|project/i.test(rawName)) {
                            type = 'Microsoft Office & Business';
                        }
                        addApp(rawName, type, fullPath, dir, 'Local Machine');
                    }
                }
            }
        } catch (e) {
            // Directory read failure
        }
    }

    cleanAppName(name) {
        if (!name) return '';
        let clean = name.replace(/\.exe$/i, '').replace(/\.lnk$/i, '');
        // Remove version numbers and trailing build numbers
        clean = clean.replace(/\s*(v?\d+(\.\d+)+|x86|x64|32-bit|64-bit|setup|installer)/gi, '');
        return clean.trim();
    }

    categorizeApp(appName, defaultType = 'Installed Application') {
        const lower = appName.toLowerCase();
        
        for (const officeApp of this.categories.office) {
            if (lower.includes(officeApp.toLowerCase())) {
                return 'Microsoft Office & Business';
            }
        }

        for (const pwaApp of this.categories.pwa) {
            if (lower.includes(pwaApp.toLowerCase())) {
                return 'Progressive Web App (PWA)';
            }
        }

        for (const prodApp of this.categories.productivity) {
            if (lower.includes(prodApp.toLowerCase())) {
                return 'Productivity & Development';
            }
        }

        for (const browser of this.categories.browsers) {
            if (lower.includes(browser.toLowerCase())) {
                return 'Web Browser & Communication';
            }
        }

        for (const media of this.categories.media) {
            if (lower.includes(media.toLowerCase())) {
                return 'Media, Design & Games';
            }
        }

        return defaultType;
    }

    async scanMacOSApps() {
        const apps = [];
        try {
            const applicationsDirs = ['/Applications', '/System/Applications', path.join(process.env.HOME || '', 'Applications')];
            for (const appDir of applicationsDirs) {
                if (fsSync.existsSync(appDir)) {
                    const entries = await fs.readdir(appDir, { withFileTypes: true });
                    for (const entry of entries) {
                        if (entry.isDirectory() && entry.name.endsWith('.app')) {
                            const appName = entry.name.replace('.app', '');
                            const appPath = path.join(appDir, entry.name);
                            apps.push({
                                name: appName,
                                type: this.categorizeApp(appName, 'Mac Application'),
                                executable: appPath,
                                path: appPath,
                                publisher: 'macOS'
                            });
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('macOS scan warning:', e.message);
        }
        return apps;
    }

    async scanLinuxApps() {
        const apps = [];
        try {
            const desktopDirs = [
                '/usr/share/applications',
                '/usr/local/share/applications',
                path.join(process.env.HOME || '', '.local/share/applications')
            ];
            for (const desktopDir of desktopDirs) {
                if (fsSync.existsSync(desktopDir)) {
                    const entries = await fs.readdir(desktopDir);
                    for (const entry of entries) {
                        if (entry.endsWith('.desktop')) {
                            const desktopFile = path.join(desktopDir, entry);
                            const content = await fs.readFile(desktopFile, 'utf8');
                            const nameMatch = content.match(/Name=(.+)/);
                            const execMatch = content.match(/Exec=(.+)/);
                            if (nameMatch) {
                                const appName = nameMatch[1].trim();
                                const execCommand = execMatch ? execMatch[1].trim().split(' ')[0] : '';
                                apps.push({
                                    name: appName,
                                    type: this.categorizeApp(appName, 'Linux Application'),
                                    executable: execCommand,
                                    path: desktopFile,
                                    publisher: 'Linux'
                                });
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('Linux scan warning:', e.message);
        }
        return apps;
    }

    removeDuplicates(apps) {
        const seen = new Set();
        return apps.filter(app => {
            const key = app.name.toLowerCase();
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    }

    async addAppFromFile(filePath, category = 'selected') {
        try {
            const stats = await fs.stat(filePath);
            if (!stats.isFile()) {
                return { success: false, error: 'Selected path is not a file' };
            }

            const fileName = path.basename(filePath);
            const ext = path.extname(filePath);
            const appName = path.basename(filePath, ext);
            const appType = this.categorizeApp(appName, 'Custom Application');

            return {
                success: true,
                app: {
                    name: appName,
                    type: appType,
                    executable: filePath,
                    path: path.dirname(filePath),
                    publisher: 'User Uploaded',
                    category: category
                }
            };
        } catch (error) {
            console.error('Error adding app from file:', error);
            return { success: false, error: error.message };
        }
    }

    async addAppByPackageName(packageName, category = 'selected') {
        const appName = packageName.trim();
        const appType = this.categorizeApp(appName, 'Package Application');
        return {
            success: true,
            app: {
                name: appName,
                type: appType,
                executable: appName,
                path: '',
                publisher: 'Package Manager',
                category: category
            }
        };
    }
}

module.exports = AppScanner;