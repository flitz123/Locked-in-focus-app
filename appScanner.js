const { exec } = require('child_process');
const util = require('util');
const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');

const execPromise = util.promisify(exec);

class AppScanner {
    constructor() {
        this.detectedApps = [];
        this.commonApps = this.getCommonApps();
    }

    getCommonApps() {
        return {
            windows: [
                'notepad.exe', 'calc.exe', 'mspaint.exe', 'write.exe', 'snippingtool.exe',
                'chrome.exe', 'firefox.exe', 'msedge.exe', 'opera.exe', 'brave.exe',
                'code.exe', 'devenv.exe', 'pycharm.exe', 'webstorm.exe', 'intellij.exe',
                'outlook.exe', 'excel.exe', 'winword.exe', 'powerpnt.exe', 'onenote.exe',
                'teams.exe', 'slack.exe', 'discord.exe', 'zoom.exe', 'skype.exe',
                'spotify.exe', 'vlc.exe', 'photoshop.exe', 'illustrator.exe', 'acrobat.exe',
                'explorer.exe', 'taskmgr.exe', 'cmd.exe', 'powershell.exe', 'regedit.exe'
            ],
            macos: [
                'Safari', 'Google Chrome', 'Firefox', 'Microsoft Edge', 'Opera',
                'Visual Studio Code', 'Xcode', 'Android Studio', 'PyCharm', 'IntelliJ IDEA',
                'Microsoft Outlook', 'Microsoft Excel', 'Microsoft Word', 'Microsoft PowerPoint',
                'Microsoft OneNote', 'Teams', 'Slack', 'Discord', 'Zoom', 'Skype',
                'Spotify', 'VLC', 'Photoshop', 'Illustrator', 'Acrobat Reader',
                'Finder', 'Terminal', 'System Preferences', 'Activity Monitor', 'Console'
            ],
            linux: [
                'firefox', 'google-chrome', 'chromium', 'opera', 'brave-browser',
                'code', 'android-studio', 'pycharm', 'intellij-idea',
                'libreoffice', 'thunderbird', 'evolution',
                'slack', 'discord', 'zoom', 'skype',
                'spotify', 'vlc', 'gimp', 'inkscape',
                'nautilus', 'gnome-terminal', 'konsole', 'system-monitor'
            ]
        };
    }

    async scanForApps() {
        try {
            const platform = process.platform;
            let apps = [];

            switch (platform) {
                case 'win32':
                    apps = await this.scanWindowsApps();
                    break;
                case 'darwin':
                    apps = await this.scanMacOSApps();
                    break;
                case 'linux':
                    apps = await this.scanLinuxApps();
                    break;
                default:
                    console.warn(`Unsupported platform: ${platform}`);
            }

            // Add common apps for the platform
            const commonApps = this.commonApps[platform] || [];
            for (const appName of commonApps) {
                if (!apps.find(app => app.name.toLowerCase() === appName.toLowerCase())) {
                    apps.push({
                        name: appName,
                        type: 'Common Application',
                        executable: appName,
                        path: '',
                        publisher: 'System'
                    });
                }
            }

            // Remove duplicates and sort
            apps = this.removeDuplicates(apps);
            apps.sort((a, b) => a.name.localeCompare(b.name));

            this.detectedApps = apps;
            return { success: true, apps: apps };
        } catch (error) {
            console.error('Error scanning for apps:', error);
            return { success: false, error: error.message, apps: [] };
        }
    }

    async scanWindowsApps() {
        const apps = [];

        try {
            // Method 1: Query registry for installed programs
            const registryQuery = `reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall" /s`;
            const { stdout } = await execPromise(registryQuery);
            
            const lines = stdout.split('\n');
            let currentApp = {};
            
            for (const line of lines) {
                const trimmed = line.trim();
                
                if (trimmed.startsWith('HKEY_')) {
                    if (currentApp.name) {
                        apps.push(currentApp);
                    }
                    currentApp = {};
                } else if (trimmed.startsWith('DisplayName')) {
                    const match = trimmed.match(/REG_SZ\s+(.+)/);
                    if (match) {
                        currentApp.name = match[1].trim();
                    }
                } else if (trimmed.startsWith('Publisher')) {
                    const match = trimmed.match(/REG_SZ\s+(.+)/);
                    if (match) {
                        currentApp.publisher = match[1].trim();
                    }
                } else if (trimmed.startsWith('InstallLocation')) {
                    const match = trimmed.match(/REG_SZ\s+(.+)/);
                    if (match) {
                        currentApp.path = match[1].trim();
                    }
                }
            }
            
            if (currentApp.name) {
                apps.push(currentApp);
            }
        } catch (error) {
            console.warn('Registry scan failed:', error.message);
        }

        try {
            // Method 2: Check common installation directories
            const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
            const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
            
            const commonDirs = [
                programFiles,
                programFilesX86,
                path.join(process.env.USERPROFILE || '', 'AppData', 'Local'),
                path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming')
            ];

            for (const baseDir of commonDirs) {
                try {
                    const entries = await fs.readdir(baseDir, { withFileTypes: true });
                    
                    for (const entry of entries) {
                        if (entry.isDirectory()) {
                            const appDir = path.join(baseDir, entry.name);
                            const exeFiles = await this.findExeFiles(appDir);
                            
                            for (const exeFile of exeFiles) {
                                const appName = path.basename(exeFile, path.extname(exeFile));
                                if (!apps.find(a => a.name === appName)) {
                                    apps.push({
                                        name: appName,
                                        type: 'Installed Application',
                                        executable: exeFile,
                                        path: appDir,
                                        publisher: 'Unknown'
                                    });
                                }
                            }
                        }
                    }
                } catch (error) {
                    console.warn(`Could not scan directory ${baseDir}:`, error.message);
                }
            }
        } catch (error) {
            console.warn('Directory scan failed:', error.message);
        }

        return apps;
    }

    async scanMacOSApps() {
        const apps = [];

        try {
            // Method 1: Scan /Applications directory
            const applicationsDir = '/Applications';
            const entries = await fs.readdir(applicationsDir, { withFileTypes: true });
            
            for (const entry of entries) {
                if (entry.isDirectory() && entry.name.endsWith('.app')) {
                    const appName = entry.name.replace('.app', '');
                    const appPath = path.join(applicationsDir, entry.name);
                    
                    apps.push({
                        name: appName,
                        type: 'Mac Application',
                        executable: appPath,
                        path: appPath,
                        publisher: 'Unknown'
                    });
                }
            }
        } catch (error) {
            console.warn('Applications directory scan failed:', error.message);
        }

        try {
            // Method 2: Use system_profiler to get installed apps
            const { stdout } = await execPromise('system_profiler SPApplicationsDataType -json');
            const data = JSON.parse(stdout);
            
            if (data && data.SPApplicationsDataType) {
                for (const appInfo of data.SPApplicationsDataType) {
                    if (appInfo.path && appInfo.path.includes('/Applications/')) {
                        apps.push({
                            name: appInfo._name || 'Unknown',
                            type: 'Mac Application',
                            executable: appInfo.path,
                            path: appInfo.path,
                            publisher: appInfo.obtained_from || 'Unknown'
                        });
                    }
                }
            }
        } catch (error) {
            console.warn('System profiler scan failed:', error.message);
        }

        return apps;
    }

    async scanLinuxApps() {
        const apps = [];

        try {
            // Method 1: Check .desktop files
            const desktopDirs = [
                '/usr/share/applications',
                '/usr/local/share/applications',
                path.join(process.env.HOME || '', '.local/share/applications')
            ];

            for (const desktopDir of desktopDirs) {
                try {
                    const entries = await fs.readdir(desktopDir);
                    
                    for (const entry of entries) {
                        if (entry.endsWith('.desktop')) {
                            const desktopFile = path.join(desktopDir, entry);
                            const content = await fs.readFile(desktopFile, 'utf8');
                            
                            const nameMatch = content.match(/Name=(.+)/);
                            const execMatch = content.match(/Exec=(.+)/);
                            
                            if (nameMatch && execMatch) {
                                const appName = nameMatch[1].trim();
                                const execCommand = execMatch[1].trim().split(' ')[0]; // Get first part of command
                                
                                apps.push({
                                    name: appName,
                                    type: 'Linux Application',
                                    executable: execCommand,
                                    path: desktopFile,
                                    publisher: 'Unknown'
                                });
                            }
                        }
                    }
                } catch (error) {
                    console.warn(`Could not scan desktop directory ${desktopDir}:`, error.message);
                }
            }
        } catch (error) {
            console.warn('Desktop files scan failed:', error.message);
        }

        try {
            // Method 2: Check common binary locations
            const pathDirs = (process.env.PATH || '').split(':');
            for (const pathDir of pathDirs) {
                try {
                    const entries = await fs.readdir(pathDir);
                    
                    for (const entry of entries) {
                        // Skip common system binaries
                        if (!['ls', 'cd', 'cp', 'mv', 'rm', 'mkdir', 'rmdir'].includes(entry)) {
                            const fullPath = path.join(pathDir, entry);
                            try {
                                const stats = await fs.stat(fullPath);
                                if (stats.isFile() && (stats.mode & parseInt('111', 8))) { // Check if executable
                                    apps.push({
                                        name: entry,
                                        type: 'System Application',
                                        executable: fullPath,
                                        path: pathDir,
                                        publisher: 'System'
                                    });
                                }
                            } catch (error) {
                                // Ignore stat errors
                            }
                        }
                    }
                } catch (error) {
                    // Ignore directory read errors
                }
            }
        } catch (error) {
            console.warn('PATH scan failed:', error.message);
        }

        return apps;
    }

    async findExeFiles(dir, depth = 0) {
        if (depth > 3) return []; // Limit recursion depth
        
        const exeFiles = [];
        
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                
                if (entry.isDirectory()) {
                    // Skip system and hidden directories
                    if (!entry.name.startsWith('.') && 
                        !['System32', 'SysWOW64', 'Windows', 'Temp', 'tmp'].includes(entry.name)) {
                        const subFiles = await this.findExeFiles(fullPath, depth + 1);
                        exeFiles.push(...subFiles);
                    }
                } else if (entry.isFile()) {
                    const ext = path.extname(entry.name).toLowerCase();
                    if (['.exe', '.com', '.bat'].includes(ext)) {
                        exeFiles.push(fullPath);
                    }
                }
            }
        } catch (error) {
            // Ignore directory access errors
        }
        
        return exeFiles;
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
                return { success: false, error: 'Path is not a file' };
            }

            const appName = path.basename(filePath, path.extname(filePath));
            const appType = this.getAppTypeFromExtension(path.extname(filePath));

            return {
                success: true,
                app: {
                    name: appName,
                    type: appType,
                    executable: filePath,
                    path: path.dirname(filePath),
                    publisher: 'User Added'
                }
            };
        } catch (error) {
            console.error('Error adding app from file:', error);
            return { success: false, error: error.message };
        }
    }

    async addAppByPackageName(packageName, category = 'selected') {
        try {
            // This would typically use system package managers
            // For now, we'll just create a placeholder app entry
            return {
                success: true,
                app: {
                    name: packageName,
                    type: 'Package Application',
                    executable: packageName,
                    path: '',
                    publisher: 'Package Manager'
                }
            };
        } catch (error) {
            console.error('Error adding app by package:', error);
            return { success: false, error: error.message };
        }
    }

    getAppTypeFromExtension(extension) {
        const typeMap = {
            '.exe': 'Windows Application',
            '.msi': 'Windows Installer',
            '.app': 'Mac Application',
            '.dmg': 'Mac Disk Image',
            '.deb': 'Debian Package',
            '.rpm': 'RPM Package',
            '.desktop': 'Linux Desktop Entry',
            '.sh': 'Shell Script',
            '.bat': 'Batch File',
            '.com': 'Command File'
        };
        
        return typeMap[extension.toLowerCase()] || 'Application';
    }

    // Enhanced scanning for specific app types
    async scanForOfficeApps() {
        const officeApps = [
            { name: 'Microsoft Word', type: 'Microsoft Office' },
            { name: 'Microsoft Excel', type: 'Microsoft Office' },
            { name: 'Microsoft PowerPoint', type: 'Microsoft Office' },
            { name: 'Microsoft Outlook', type: 'Microsoft Office' },
            { name: 'Microsoft OneNote', type: 'Microsoft Office' },
            { name: 'Microsoft Teams', type: 'Microsoft Office' },
            { name: 'LibreOffice Writer', type: 'Office Suite' },
            { name: 'LibreOffice Calc', type: 'Office Suite' },
            { name: 'LibreOffice Impress', type: 'Office Suite' },
            { name: 'Google Docs', type: 'Web Application' },
            { name: 'Google Sheets', type: 'Web Application' },
            { name: 'Google Slides', type: 'Web Application' }
        ];

        return officeApps;
    }

    async scanForProductivityApps() {
        const productivityApps = [
            { name: 'Slack', type: 'Communication' },
            { name: 'Discord', type: 'Communication' },
            { name: 'Zoom', type: 'Video Conferencing' },
            { name: 'Microsoft Teams', type: 'Collaboration' },
            { name: 'Trello', type: 'Project Management' },
            { name: 'Asana', type: 'Project Management' },
            { name: 'Notion', type: 'Note Taking' },
            { name: 'Evernote', type: 'Note Taking' },
            { name: 'Todoist', type: 'Task Management' },
            { name: 'Visual Studio Code', type: 'Development' },
            { name: 'Sublime Text', type: 'Development' },
            { name: 'Atom', type: 'Development' }
        ];

        return productivityApps;
    }
}

module.exports = AppScanner;