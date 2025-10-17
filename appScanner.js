const { app, shell } = require('electron');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class AppScanner {
    constructor() {
        this.detectedApps = [];
        this.commonAppPaths = this.getCommonAppPaths();
    }

    getCommonAppPaths() {
        const commonPaths = {
            win32: [
                'C:\\Program Files',
                'C:\\Program Files (x86)',
                path.join(process.env.APPDATA || '', '..', 'Local', 'Programs'),
                path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
                path.join(process.env.LOCALAPPDATA || '', 'Programs')
            ],
            darwin: [
                '/Applications',
                '/System/Applications',
                path.join(process.env.HOME || '', 'Applications')
            ],
            linux: [
                '/usr/share/applications',
                '/usr/local/share/applications',
                path.join(process.env.HOME || '', '.local/share/applications'),
                '/opt'
            ]
        };

        return commonPaths[process.platform] || [];
    }

    async scanForApps() {
        try {
            console.log('Starting deep app scan...');
            this.detectedApps = [];

            // Scan common installation directories
            await this.scanCommonDirectories();

            // Scan for Microsoft Office apps
            await this.scanMicrosoftOfficeApps();

            // Scan for PWAs and web apps
            await this.scanWebApps();

            // Scan using system package managers
            await this.scanPackageManager();

            // Scan running processes
            await this.scanRunningProcesses();

            // Remove duplicates and sort
            this.detectedApps = this.removeDuplicates(this.detectedApps);
            this.detectedApps.sort((a, b) => a.name.localeCompare(b.name));

            console.log(`Scan completed. Found ${this.detectedApps.length} applications.`);
            
            return {
                success: true,
                count: this.detectedApps.length,
                apps: this.detectedApps
            };
        } catch (error) {
            console.error('Error during app scan:', error);
            return {
                success: false,
                error: error.message,
                apps: []
            };
        }
    }

    async scanCommonDirectories() {
        for (const basePath of this.commonAppPaths) {
            try {
                await this.scanDirectoryRecursive(basePath);
            } catch (error) {
                console.warn(`Could not scan directory ${basePath}:`, error.message);
            }
        }
    }

    async scanDirectoryRecursive(dirPath, depth = 0) {
        if (depth > 3) return; // Limit recursion depth for performance

        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                
                try {
                    if (entry.isDirectory()) {
                        // Skip system directories to improve performance
                        if (this.shouldSkipDirectory(entry.name)) {
                            continue;
                        }
                        // Recursively scan subdirectories
                        await this.scanDirectoryRecursive(fullPath, depth + 1);
                    } else if (this.isExecutableFile(entry.name)) {
                        // Found an executable file
                        const appInfo = await this.extractAppInfo(fullPath);
                        if (appInfo) {
                            this.detectedApps.push(appInfo);
                        }
                    }
                } catch (error) {
                    // Skip files/directories we can't access
                    continue;
                }
            }
        } catch (error) {
            // Skip directories we can't read
            console.warn(`Cannot read directory ${dirPath}:`, error.message);
        }
    }

    shouldSkipDirectory(dirName) {
        const skipDirs = ['node_modules', '.git', 'Windows', 'System32', 'SysWOW64', 'Temp', 'tmp', 'cache', 'logs'];
        return skipDirs.includes(dirName.toLowerCase());
    }

    isExecutableFile(filename) {
        const ext = path.extname(filename).toLowerCase();
        const executableExtensions = {
            win32: ['.exe', '.msi', '.com', '.bat', '.cmd', '.lnk'],
            darwin: ['.app', '.dmg', '.pkg', '.command'],
            linux: ['.desktop', '.sh', '.bin', '.AppImage', '.deb', '.rpm']
        };

        const platformExtensions = executableExtensions[process.platform] || [];
        return platformExtensions.includes(ext);
    }

    async extractAppInfo(filePath) {
        try {
            const stats = await fs.stat(filePath);
            const filename = path.basename(filePath);
            const appName = this.cleanAppName(filename);

            return {
                name: appName,
                path: filePath,
                type: this.determineAppType(filePath),
                size: stats.size,
                lastModified: stats.mtime,
                publisher: await this.getPublisherInfo(filePath),
                executable: this.isExecutableFile(filename) ? filePath : null
            };
        } catch (error) {
            console.warn(`Could not extract app info for ${filePath}:`, error.message);
            return null;
        }
    }

    cleanAppName(filename) {
        // Remove file extensions and common suffixes
        let name = path.basename(filename, path.extname(filename));
        
        // Remove common version numbers and architecture indicators
        name = name.replace(/\s*(x86|x64|32bit|64bit|setup|installer).*/gi, '');
        name = name.replace(/\s*v?\d+\.\d+.*$/, '');
        
        // Clean up whitespace and special characters
        name = name.trim().replace(/[^\w\s-]/g, '');
        
        return name || filename;
    }

    determineAppType(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const filename = path.basename(filePath).toLowerCase();
        const filePathLower = filePath.toLowerCase();

        if (filePathLower.includes('microsoft office') || filePathLower.includes('office')) {
            return 'Microsoft Office';
        } else if (filePathLower.includes('chrome') || filePathLower.includes('browser')) {
            return 'Web Browser';
        } else if (filename.includes('microsoft') || filename.includes('office')) {
            return 'Microsoft Office';
        } else if (ext === '.exe') {
            return 'Windows Application';
        } else if (ext === '.app') {
            return 'macOS Application';
        } else if (ext === '.desktop') {
            return 'Linux Application';
        } else if (filename.includes('pwa') || filename.includes('progressive')) {
            return 'Progressive Web App';
        } else if (filePathLower.includes('program files')) {
            return 'Installed Application';
        } else {
            return 'Application';
        }
    }

    async getPublisherInfo(filePath) {
        if (process.platform === 'win32') {
            try {
                // Use PowerShell to get file version info
                const command = `powershell -Command "(Get-Item '${filePath.replace(/'/g, "''")}').VersionInfo.CompanyName"`;
                const { stdout } = await execPromise(command);
                const publisher = stdout.trim();
                return publisher || 'Unknown';
            } catch (error) {
                return 'Unknown';
            }
        }
        return 'Unknown';
    }

    async scanMicrosoftOfficeApps() {
        const officeApps = [
            { name: 'Microsoft Word', exe: 'WINWORD.EXE' },
            { name: 'Microsoft Excel', exe: 'EXCEL.EXE' },
            { name: 'Microsoft PowerPoint', exe: 'POWERPNT.EXE' },
            { name: 'Microsoft Outlook', exe: 'OUTLOOK.EXE' },
            { name: 'Microsoft OneNote', exe: 'ONENOTE.EXE' },
            { name: 'Microsoft Access', exe: 'MSACCESS.EXE' },
            { name: 'Microsoft Publisher', exe: 'MSPUB.EXE' },
            { name: 'Microsoft Teams', exe: 'TEAMS.EXE' }
        ];

        for (const app of officeApps) {
            const appPath = await this.findOfficeApp(app);
            if (appPath) {
                this.detectedApps.push({
                    name: app.name,
                    path: appPath,
                    type: 'Microsoft Office',
                    publisher: 'Microsoft Corporation',
                    executable: appPath
                });
            }
        }
    }

    async findOfficeApp(appInfo) {
        const searchPaths = {
            win32: [
                `C:\\Program Files\\Microsoft Office\\root\\Office16\\${appInfo.exe}`,
                `C:\\Program Files (x86)\\Microsoft Office\\root\\Office16\\${appInfo.exe}`,
                `C:\\Program Files\\Microsoft Office\\Office16\\${appInfo.exe}`,
                `C:\\Program Files (x86)\\Microsoft Office\\Office16\\${appInfo.exe}`,
                `C:\\Program Files\\Microsoft Office\\root\\Office15\\${appInfo.exe}`,
                `C:\\Program Files (x86)\\Microsoft Office\\root\\Office15\\${appInfo.exe}`,
                `C:\\Program Files\\Microsoft 365\\Office16\\${appInfo.exe}`
            ],
            darwin: [
                `/Applications/${appInfo.name}.app`,
                `/Applications/Microsoft ${appInfo.name.replace('Microsoft ', '')}.app`
            ]
        };

        const paths = searchPaths[process.platform] || [];
        for (const testPath of paths) {
            try {
                await fs.access(testPath);
                return testPath;
            } catch (error) {
                continue;
            }
        }
        return null;
    }

    async scanWebApps() {
        // Scan for browser profiles to find installed PWAs
        const browsers = [
            { name: 'Google Chrome', paths: [
                path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data'),
                path.join(process.env.APPDATA || '', 'Google', 'Chrome')
            ]},
            { name: 'Microsoft Edge', paths: [
                path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'User Data')
            ]},
            { name: 'Mozilla Firefox', paths: [
                path.join(process.env.APPDATA || '', 'Mozilla', 'Firefox', 'Profiles')
            ]}
        ];

        for (const browser of browsers) {
            const pwas = await this.findPWAsForBrowser(browser);
            this.detectedApps.push(...pwas);
        }
    }

    async findPWAsForBrowser(browser) {
        const pwas = [];
        
        for (const basePath of browser.paths) {
            try {
                // Look for PWA manifests and installation directories
                const entries = await fs.readdir(basePath, { withFileTypes: true });
                
                for (const entry of entries) {
                    if (entry.isDirectory() && entry.name.includes('Application') || entry.name.includes('PWA')) {
                        pwas.push({
                            name: `${browser.name} - ${entry.name}`,
                            path: path.join(basePath, entry.name),
                            type: 'Progressive Web App',
                            publisher: browser.name
                        });
                    }
                }
            } catch (error) {
                // Skip if we can't read the directory
                continue;
            }
        }

        return pwas;
    }

    async scanRunningProcesses() {
        try {
            let command;
            if (process.platform === 'win32') {
                command = 'tasklist /fo csv /nh';
            } else if (process.platform === 'darwin') {
                command = 'ps -A -o comm';
            } else {
                command = 'ps -A -o cmd';
            }

            const { stdout } = await execPromise(command);
            const lines = stdout.split('\n');
            
            for (const line of lines) {
                const processName = this.extractProcessName(line);
                if (processName && !this.detectedApps.some(app => app.name === processName)) {
                    this.detectedApps.push({
                        name: processName,
                        path: 'Running Process',
                        type: 'Running Application',
                        publisher: 'System'
                    });
                }
            }
        } catch (error) {
            console.warn('Could not scan running processes:', error.message);
        }
    }

    extractProcessName(line) {
        if (process.platform === 'win32') {
            // CSV format: "process.exe","1234","Console"
            const match = line.match(/"([^"]+\.exe)"/i);
            return match ? path.basename(match[1], '.exe') : null;
        } else {
            // Unix format: processname or /path/to/process
            const parts = line.trim().split(/\s+/);
            const lastPart = parts[parts.length - 1];
            return path.basename(lastPart).replace(/\.[^/.]+$/, ""); // Remove extension
        }
    }

    async scanPackageManager() {
        try {
            if (process.platform === 'win32') {
                await this.scanWindowsPackageManager();
            } else if (process.platform === 'darwin') {
                await this.scanMacPackageManager();
            } else if (process.platform === 'linux') {
                await this.scanLinuxPackageManager();
            }
        } catch (error) {
            console.warn('Package manager scan failed:', error.message);
        }
    }

    async scanWindowsPackageManager() {
        try {
            // Check Winget
            const { stdout } = await execPromise('winget list --accept-source-agreements');
            const lines = stdout.split('\n');
            
            for (const line of lines.slice(2)) { // Skip header lines
                const match = line.match(/^([^ ]+)\s+([^ ]+)\s+([^ ]+)/);
                if (match) {
                    const [, name, , publisher] = match;
                    const cleanName = name.trim();
                    if (cleanName && !this.detectedApps.some(app => app.name === cleanName)) {
                        this.detectedApps.push({
                            name: cleanName,
                            path: 'Winget Package',
                            type: 'Windows Package',
                            publisher: publisher.trim()
                        });
                    }
                }
            }
        } catch (error) {
            // Winget might not be available
        }
    }

    async scanMacPackageManager() {
        try {
            // Check Homebrew
            const { stdout } = await execPromise('brew list --cask');
            const apps = stdout.split('\n');
            
            for (const app of apps) {
                const cleanName = app.trim();
                if (cleanName && !this.detectedApps.some(detected => detected.name === cleanName)) {
                    this.detectedApps.push({
                        name: cleanName,
                        path: 'Homebrew Cask',
                        type: 'macOS Application',
                        publisher: 'Homebrew'
                    });
                }
            }
        } catch (error) {
            // Homebrew might not be available
        }
    }

    async scanLinuxPackageManager() {
        try {
            // Check dpkg (Debian/Ubuntu)
            const { stdout } = await execPromise('dpkg -l | grep "^ii"');
            const lines = stdout.split('\n');
            
            for (const line of lines) {
                const match = line.match(/^ii\s+(\S+)\s+(\S+)/);
                if (match) {
                    const [, packageName] = match;
                    if (packageName && !this.detectedApps.some(app => app.name === packageName)) {
                        this.detectedApps.push({
                            name: packageName,
                            path: 'System Package',
                            type: 'Linux Application',
                            publisher: 'System Repository'
                        });
                    }
                }
            }
        } catch (error) {
            // dpkg might not be available
        }
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

    searchApps(query) {
        const searchTerm = query.toLowerCase();
        return this.detectedApps.filter(app => 
            app.name.toLowerCase().includes(searchTerm) ||
            app.type.toLowerCase().includes(searchTerm) ||
            (app.publisher && app.publisher.toLowerCase().includes(searchTerm))
        );
    }

    getDetectedApps() {
        return this.detectedApps;
    }

    async addAppFromFile(filePath, category = 'selected') {
        try {
            const appInfo = await this.extractAppInfo(filePath);
            if (appInfo) {
                return {
                    success: true,
                    app: appInfo,
                    category: category
                };
            } else {
                return {
                    success: false,
                    error: 'Could not extract app information from file'
                };
            }
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    async addAppByPackageName(packageName, category = 'selected') {
        try {
            return {
                success: true,
                app: {
                    name: packageName,
                    path: 'Package Manager',
                    type: 'Package Manager Application',
                    publisher: 'System Package Manager'
                },
                category: category
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = AppScanner;