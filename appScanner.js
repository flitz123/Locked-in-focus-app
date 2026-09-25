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
        this.categories = {
            office: ['Word', 'Excel', 'PowerPoint', 'Outlook', 'OneNote', 'Teams', 'Access', 'Publisher', 'Visio', 'Project', '365', 'Office'],
            productivity: ['Code', 'Visual Studio', 'Notion', 'Obsidian', 'Slack', 'Discord', 'Zoom', 'Trello', 'Asana', 'Figma', 'Todoist', 'Evernote', 'Git', 'Sublime', 'PyCharm', 'IntelliJ', 'WebStorm', 'Postman', 'Docker', 'Terminal', 'PowerShell'],
            pwa: ['PWA', 'Chrome App', 'Edge App', 'Web App', 'Google Docs', 'Google Sheets', 'Google Slides', 'Canva', 'WhatsApp Web', 'Telegram Web', 'YouTube Music', 'Linear'],
            browsers: ['Chrome', 'Edge', 'Firefox', 'Brave', 'Opera', 'Vivaldi', 'Safari', 'Chromium', 'Tor Browser'],
            media: ['Spotify', 'VLC', 'Photoshop', 'Illustrator', 'Premiere', 'After Effects', 'Blender', 'Audacity', 'Steam', 'Epic Games', 'GIMP']
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

            // Also add standard common & office apps to ensure comprehensive coverage
            const curatedApps = this.getCuratedApps();
            for (const item of curatedApps) {
                if (!apps.some(a => a.name.toLowerCase() === item.name.toLowerCase())) {
                    apps.push(item);
                }
            }

            // Remove duplicates and sort alphabetically
            apps = this.removeDuplicates(apps);
            apps.sort((a, b) => a.name.localeCompare(b.name));

            this.detectedApps = apps;
            return { success: true, apps: apps };
        } catch (error) {
            console.error('Error scanning for apps:', error);
            return { success: false, error: error.message, apps: this.getCuratedApps() };
        }
    }

    async scanWindowsDeep() {
        const apps = [];
        const seenNames = new Set();

        const addApp = (name, type, executable = '', appPath = '', publisher = '') => {
            if (!name || typeof name !== 'string') return;
            const cleanName = name.trim();
            if (!cleanName || cleanName.length < 2) return;
            
            // Filter out system updates, drivers, and junk
            if (/^(KB\d+|Security Update|Hotfix|Update for |Windows Software Development Kit|Microsoft Visual C\+\+ 20\d\d Redistributable|Microsoft .NET Framework)/i.test(cleanName)) {
                return;
            }

            const lower = cleanName.toLowerCase();
            if (seenNames.has(lower)) return;
            seenNames.add(lower);

            const category = this.categorizeApp(cleanName, type);
            apps.push({
                name: cleanName,
                type: category,
                executable: executable || cleanName,
                path: appPath || '',
                publisher: publisher || 'Unknown'
            });
        };

        // 1. Scan Start Menu Shortcuts (User and All Users)
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

        // 2. Scan Registry Uninstall Keys (64-bit, 32-bit, HKCU User)
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
                            const iconPath = match[1].split(',')[0].trim().replace(/^"|"$/g, '');
                            if (iconPath.toLowerCase().endsWith('.exe')) {
                                currentApp.exe = iconPath;
                            }
                        }
                    } else if (trimmed.startsWith('InstallLocation')) {
                        const match = trimmed.match(/InstallLocation\s+REG_SZ\s+(.+)/i);
                        if (match) currentApp.path = match[1].trim();
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
                // Registry key might not exist or had read timeout
            }
        }

        // 3. Scan Chrome & Edge Progressive Web Apps (PWAs)
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
                            addApp(name, 'Progressive Web App (PWA)', '', pwaDir, 'PWA');
                        }
                    }
                }
            }
        } catch (e) {
            // Ignore PWA read error
        }

        // 4. Scan Currently Running Processes with Main Window
        try {
            const { stdout } = await execPromise('powershell -NoProfile "Get-Process | Where-Object {$_.MainWindowHandle -ne 0} | Select-Object -Unique ProcessName, MainWindowTitle | ConvertTo-Json"', { timeout: 3000 });
            if (stdout && stdout.trim()) {
                const procs = JSON.parse(stdout.trim());
                const procList = Array.isArray(procs) ? procs : [procs];
                for (const p of procList) {
                    if (p && p.ProcessName) {
                        const name = p.ProcessName;
                        if (!['electron', 'locked-in', 'explorer', 'shellexperiencehost', 'searchapp', 'systemsettings'].includes(name.toLowerCase())) {
                            addApp(name, 'Running Application', `${name}.exe`, '', 'System');
                        }
                    }
                }
            }
        } catch (e) {
            // Ignore process list error
        }

        return apps;
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
                    const appName = path.basename(entry.name, '.lnk');
                    // Skip uninstallers, help files, readme
                    if (!/uninstall|documentation|help|read me|website|release notes/i.test(appName)) {
                        let type = 'Installed Application';
                        if (/word|excel|powerpoint|outlook|onenote|teams|access|publisher/i.test(appName)) {
                            type = 'Microsoft Office';
                        }
                        addApp(appName, type, fullPath, dir, 'Local Machine');
                    }
                }
            }
        } catch (e) {
            // Directory read failure
        }
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

    getCuratedApps() {
        return [
            // Microsoft Office & 365 Suite
            { name: 'Microsoft Word', type: 'Microsoft Office & Business', executable: 'winword.exe', publisher: 'Microsoft Corporation' },
            { name: 'Microsoft Excel', type: 'Microsoft Office & Business', executable: 'excel.exe', publisher: 'Microsoft Corporation' },
            { name: 'Microsoft PowerPoint', type: 'Microsoft Office & Business', executable: 'powerpnt.exe', publisher: 'Microsoft Corporation' },
            { name: 'Microsoft Outlook', type: 'Microsoft Office & Business', executable: 'outlook.exe', publisher: 'Microsoft Corporation' },
            { name: 'Microsoft OneNote', type: 'Microsoft Office & Business', executable: 'onenote.exe', publisher: 'Microsoft Corporation' },
            { name: 'Microsoft Teams', type: 'Microsoft Office & Business', executable: 'teams.exe', publisher: 'Microsoft Corporation' },
            { name: 'Microsoft Access', type: 'Microsoft Office & Business', executable: 'msaccess.exe', publisher: 'Microsoft Corporation' },
            { name: 'Microsoft Publisher', type: 'Microsoft Office & Business', executable: 'mspub.exe', publisher: 'Microsoft Corporation' },
            
            // Productivity & Dev
            { name: 'Visual Studio Code', type: 'Productivity & Development', executable: 'code.exe', publisher: 'Microsoft' },
            { name: 'Visual Studio', type: 'Productivity & Development', executable: 'devenv.exe', publisher: 'Microsoft' },
            { name: 'Notion', type: 'Productivity & Development', executable: 'Notion.exe', publisher: 'Notion Labs' },
            { name: 'Obsidian', type: 'Productivity & Development', executable: 'Obsidian.exe', publisher: 'Obsidian' },
            { name: 'Slack', type: 'Productivity & Development', executable: 'slack.exe', publisher: 'Slack Technologies' },
            { name: 'Discord', type: 'Web Browser & Communication', executable: 'discord.exe', publisher: 'Discord Inc.' },
            { name: 'Zoom', type: 'Productivity & Development', executable: 'Zoom.exe', publisher: 'Zoom Video Communications' },
            { name: 'Figma', type: 'Productivity & Development', executable: 'Figma.exe', publisher: 'Figma' },
            { name: 'Postman', type: 'Productivity & Development', executable: 'Postman.exe', publisher: 'Postman' },
            
            // PWAs & Web Apps
            { name: 'Google Docs (PWA)', type: 'Progressive Web App (PWA)', executable: 'chrome.exe --app=https://docs.google.com', publisher: 'Google' },
            { name: 'Google Sheets (PWA)', type: 'Progressive Web App (PWA)', executable: 'chrome.exe --app=https://sheets.google.com', publisher: 'Google' },
            { name: 'Google Slides (PWA)', type: 'Progressive Web App (PWA)', executable: 'chrome.exe --app=https://slides.google.com', publisher: 'Google' },
            { name: 'Linear (PWA)', type: 'Progressive Web App (PWA)', executable: 'https://linear.app', publisher: 'Linear' },
            { name: 'Trello (PWA)', type: 'Progressive Web App (PWA)', executable: 'https://trello.com', publisher: 'Atlassian' },
            { name: 'Canva (PWA)', type: 'Progressive Web App (PWA)', executable: 'https://canva.com', publisher: 'Canva' },

            // Browsers
            { name: 'Google Chrome', type: 'Web Browser & Communication', executable: 'chrome.exe', publisher: 'Google LLC' },
            { name: 'Microsoft Edge', type: 'Web Browser & Communication', executable: 'msedge.exe', publisher: 'Microsoft' },
            { name: 'Mozilla Firefox', type: 'Web Browser & Communication', executable: 'firefox.exe', publisher: 'Mozilla' },
            { name: 'Brave Browser', type: 'Web Browser & Communication', executable: 'brave.exe', publisher: 'Brave Software' },

            // Utilities
            { name: 'Notepad', type: 'Productivity & Development', executable: 'notepad.exe', publisher: 'Microsoft Windows' },
            { name: 'Calculator', type: 'Productivity & Development', executable: 'calc.exe', publisher: 'Microsoft Windows' },
            { name: 'Paint', type: 'Media, Design & Games', executable: 'mspaint.exe', publisher: 'Microsoft Windows' },
            { name: 'Spotify', type: 'Media, Design & Games', executable: 'spotify.exe', publisher: 'Spotify AB' }
        ];
    }

    async scanMacOSApps() {
        const apps = [];
        try {
            const applicationsDir = '/Applications';
            const entries = await fs.readdir(applicationsDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && entry.name.endsWith('.app')) {
                    const appName = entry.name.replace('.app', '');
                    const appPath = path.join(applicationsDir, entry.name);
                    apps.push({
                        name: appName,
                        type: this.categorizeApp(appName, 'Mac Application'),
                        executable: appPath,
                        path: appPath,
                        publisher: 'macOS'
                    });
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