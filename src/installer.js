const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const os = require('os');

class LockedInInstaller {
    constructor() {
        this.appName = 'Locked In';
        this.appVersion = '1.0.0';
        this.appExecutable = 'locked-in-focus-app.exe';
        this.installDir = path.join(os.homedir(), 'AppData', 'Local', 'LockedIn');
        this.startMenuDir = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs');
        this.desktopPath = path.join(os.homedir(), 'Desktop');
        this.currentDir = __dirname;
        
        this.log('Locked In Installer initialized');
        this.log(`Install directory: ${this.installDir}`);
    }

    log(message) {
        console.log(`[Installer] ${new Date().toISOString()} - ${message}`);
    }

    error(message) {
        console.error(`[Installer ERROR] ${new Date().toISOString()} - ${message}`);
    }

    // Check if running as administrator (Windows)
    isAdmin() {
        try {
            execSync('net session', { stdio: 'ignore' });
            return true;
        } catch {
            return false;
        }
    }

    // Create necessary directories
    async createDirectories() {
        this.log('Creating installation directories...');
        
        const directories = [
            this.installDir,
            path.join(this.installDir, 'src'),
            path.join(this.installDir, 'build'),
            path.join(this.installDir, 'assets'),
            path.join(this.installDir, 'data')
        ];

        for (const dir of directories) {
            try {
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                    this.log(`Created directory: ${dir}`);
                }
            } catch (error) {
                this.error(`Failed to create directory ${dir}: ${error.message}`);
                throw error;
            }
        }
    }

    // Copy application files
    async copyFiles() {
        this.log('Copying application files...');
        
        const filesToCopy = [
            // Main files
            { src: 'package.json', dest: 'package.json' },
            { src: 'index.html', dest: 'index.html' },
            { src: 'styles.css', dest: 'styles.css' },
            { src: 'app.js', dest: 'app.js' },
            { src: 'focusManager.js', dest: 'focusManager.js' },
            
            // Source files
            { src: 'src/main.js', dest: 'src/main.js' },
            { src: 'src/preload.js', dest: 'src/preload.js' },
            { src: 'src/renderer.js', dest: 'src/renderer.js' },
            
            // Build files (if they exist)
            { src: 'build/icon.ico', dest: 'build/icon.ico', optional: true },
            { src: 'build/icon.png', dest: 'build/icon.png', optional: true },
            { src: 'build/icon.icns', dest: 'build/icon.icns', optional: true },
        ];

        for (const file of filesToCopy) {
            const srcPath = path.join(this.currentDir, file.src);
            const destPath = path.join(this.installDir, file.dest);
            
            try {
                if (fs.existsSync(srcPath)) {
                    // Ensure destination directory exists
                    const destDir = path.dirname(destPath);
                    if (!fs.existsSync(destDir)) {
                        fs.mkdirSync(destDir, { recursive: true });
                    }
                    
                    fs.copyFileSync(srcPath, destPath);
                    this.log(`Copied: ${file.src} -> ${file.dest}`);
                } else if (!file.optional) {
                    throw new Error(`Required file not found: ${srcPath}`);
                } else {
                    this.log(`Optional file not found, skipping: ${file.src}`);
                }
            } catch (error) {
                if (!file.optional) {
                    this.error(`Failed to copy ${file.src}: ${error.message}`);
                    throw error;
                } else {
                    this.log(`Failed to copy optional file ${file.src}: ${error.message}`);
                }
            }
        }
    }

    // Install Node.js dependencies
    async installDependencies() {
        this.log('Installing Node.js dependencies...');
        
        try {
            // Check if npm is available
            execSync('npm --version', { stdio: 'ignore' });
        } catch {
            this.error('npm is not installed or not in PATH. Please install Node.js first.');
            throw new Error('npm not found');
        }

        try {
            // Change to install directory and install dependencies
            process.chdir(this.installDir);
            
            this.log('Running npm install...');
            execSync('npm install --production', { 
                stdio: 'inherit',
                cwd: this.installDir 
            });
            
            this.log('Dependencies installed successfully');
        } catch (error) {
            this.error(`Failed to install dependencies: ${error.message}`);
            throw error;
        }
    }

    // Create application icons and shortcuts
    async createShortcuts() {
        this.log('Creating shortcuts...');
        
        // Create default icon if none exists
        await this.createDefaultIcon();
        
        // Create Start Menu shortcut
        await this.createStartMenuShortcut();
        
        // Create Desktop shortcut
        await this.createDesktopShortcut();
        
        // Register with Windows (add to Programs and Features)
        await this.registerWithWindows();
    }

    // Create a simple default icon
    async createDefaultIcon() {
        const iconPath = path.join(this.installDir, 'build', 'icon.ico');
        
        if (!fs.existsSync(iconPath)) {
            this.log('Creating default application icon...');
            
            // Create build directory if it doesn't exist
            const buildDir = path.dirname(iconPath);
            if (!fs.existsSync(buildDir)) {
                fs.mkdirSync(buildDir, { recursive: true });
            }
            
            // For simplicity, we'll copy a default Windows icon or create a placeholder
            // In a real installer, you'd want to include proper icon files
            try {
                // Try to copy the Windows calculator icon as a placeholder
                const defaultIconPath = 'C:\\Windows\\System32\\calc.exe';
                if (fs.existsSync(defaultIconPath)) {
                    // Note: This won't actually extract the icon, but serves as a placeholder
                    // You should include proper .ico files in your distribution
                    this.log('Using system icon as placeholder');
                }
            } catch (error) {
                this.log('Could not create icon, application will use default');
            }
        }
    }

    // Create Start Menu shortcut
    async createStartMenuShortcut() {
        try {
            const shortcutPath = path.join(this.startMenuDir, `${this.appName}.lnk`);
            const targetPath = path.join(this.installDir, 'node_modules', '.bin', 'electron.cmd');
            const workingDir = this.installDir;
            
            // Create VBS script to create shortcut (Windows doesn't have built-in shortcut creation from command line)
            const vbsScript = `
Set oWS = WScript.CreateObject("WScript.Shell")
sLinkFile = "${shortcutPath.replace(/\\/g, '\\\\')}"
Set oLink = oWS.CreateShortcut(sLinkFile)
oLink.TargetPath = "cmd.exe"
oLink.Arguments = "/c cd /d \\"${workingDir.replace(/\\/g, '\\\\')}\\" && npm start"
oLink.WorkingDirectory = "${workingDir.replace(/\\/g, '\\\\')}"
oLink.Description = "${this.appName} - Focus and App Blocker"
oLink.WindowStyle = 1
oLink.Save
            `;
            
            const vbsPath = path.join(os.tmpdir(), 'create_shortcut.vbs');
            fs.writeFileSync(vbsPath, vbsScript);
            
            execSync(`cscript //nologo "${vbsPath}"`, { stdio: 'ignore' });
            fs.unlinkSync(vbsPath);
            
            this.log(`Created Start Menu shortcut: ${shortcutPath}`);
        } catch (error) {
            this.error(`Failed to create Start Menu shortcut: ${error.message}`);
            // Don't throw - shortcuts are not critical
        }
    }

    // Create Desktop shortcut
    async createDesktopShortcut() {
        try {
            const shortcutPath = path.join(this.desktopPath, `${this.appName}.lnk`);
            const workingDir = this.installDir;
            
            const vbsScript = `
Set oWS = WScript.CreateObject("WScript.Shell")
sLinkFile = "${shortcutPath.replace(/\\/g, '\\\\')}"
Set oLink = oWS.CreateShortcut(sLinkFile)
oLink.TargetPath = "cmd.exe"
oLink.Arguments = "/c cd /d \\"${workingDir.replace(/\\/g, '\\\\')}\\" && npm start"
oLink.WorkingDirectory = "${workingDir.replace(/\\/g, '\\\\')}"
oLink.Description = "${this.appName} - Focus and App Blocker"
oLink.WindowStyle = 1
oLink.Save
            `;
            
            const vbsPath = path.join(os.tmpdir(), 'create_desktop_shortcut.vbs');
            fs.writeFileSync(vbsPath, vbsScript);
            
            execSync(`cscript //nologo "${vbsPath}"`, { stdio: 'ignore' });
            fs.unlinkSync(vbsPath);
            
            this.log(`Created Desktop shortcut: ${shortcutPath}`);
        } catch (error) {
            this.error(`Failed to create Desktop shortcut: ${error.message}`);
            // Don't throw - shortcuts are not critical
        }
    }

    // Register application with Windows
    async registerWithWindows() {
        try {
            this.log('Registering application with Windows...');
            
            // Create uninstaller script
            const uninstallerPath = path.join(this.installDir, 'uninstall.bat');
            const uninstallScript = `@echo off
echo Uninstalling ${this.appName}...
cd /d "${this.installDir}"
rmdir /s /q node_modules
del /q package-lock.json
cd ..
rmdir /s /q LockedIn
del /q "${path.join(this.startMenuDir, this.appName + '.lnk')}"
del /q "${path.join(this.desktopPath, this.appName + '.lnk')}"
echo ${this.appName} has been uninstalled.
pause
`;
            
            fs.writeFileSync(uninstallerPath, uninstallScript);
            this.log('Created uninstaller script');
            
            // Create application info file
            const appInfoPath = path.join(this.installDir, 'app-info.json');
            const appInfo = {
                name: this.appName,
                version: this.appVersion,
                installDate: new Date().toISOString(),
                installPath: this.installDir,
                uninstallerPath: uninstallerPath
            };
            
            fs.writeFileSync(appInfoPath, JSON.stringify(appInfo, null, 2));
            this.log('Created application info file');
            
        } catch (error) {
            this.error(`Failed to register with Windows: ${error.message}`);
            // Don't throw - registration is not critical for functionality
        }
    }

    // Create a startup script for easier launching
    async createStartupScript() {
        const startupScriptPath = path.join(this.installDir, 'start.bat');
        const startupScript = `@echo off
title ${this.appName}
cd /d "%~dp0"
echo Starting ${this.appName}...
npm start
pause
`;
        
        fs.writeFileSync(startupScriptPath, startupScript);
        this.log(`Created startup script: ${startupScriptPath}`);
    }

    // Main installation process
    async install() {
        try {
            this.log(`Starting installation of ${this.appName} v${this.appVersion}`);
            this.log(`Platform: ${os.platform()} ${os.arch()}`);
            this.log(`Node.js version: ${process.version}`);
            
            // Check prerequisites
            if (os.platform() !== 'win32') {
                throw new Error('This installer is designed for Windows only');
            }
            
            // Run installation steps
            await this.createDirectories();
            await this.copyFiles();
            await this.installDependencies();
            await this.createShortcuts();
            await this.createStartupScript();
            
            this.log(`Installation completed successfully!`);
            this.log(`Application installed to: ${this.installDir}`);
            this.log(`You can start the application from:`);
            this.log(`  - Start Menu: ${this.appName}`);
            this.log(`  - Desktop shortcut: ${this.appName}.lnk`);
            this.log(`  - Command line: cd "${this.installDir}" && npm start`);
            
            return {
                success: true,
                installPath: this.installDir,
                message: 'Installation completed successfully!'
            };
            
        } catch (error) {
            this.error(`Installation failed: ${error.message}`);
            
            // Attempt cleanup on failure
            try {
                await this.cleanup();
            } catch (cleanupError) {
                this.error(`Cleanup failed: ${cleanupError.message}`);
            }
            
            return {
                success: false,
                error: error.message,
                message: 'Installation failed. Please check the logs and try again.'
            };
        }
    }

    // Cleanup failed installation
    async cleanup() {
        this.log('Cleaning up failed installation...');
        
        try {
            if (fs.existsSync(this.installDir)) {
                // Remove installation directory
                fs.rmSync(this.installDir, { recursive: true, force: true });
                this.log('Removed installation directory');
            }
            
            // Remove shortcuts
            const shortcuts = [
                path.join(this.startMenuDir, `${this.appName}.lnk`),
                path.join(this.desktopPath, `${this.appName}.lnk`)
            ];
            
            for (const shortcut of shortcuts) {
                if (fs.existsSync(shortcut)) {
                    fs.unlinkSync(shortcut);
                    this.log(`Removed shortcut: ${shortcut}`);
                }
            }
            
        } catch (error) {
            this.error(`Cleanup error: ${error.message}`);
        }
    }

    // Check if already installed
    isInstalled() {
        return fs.existsSync(this.installDir) && fs.existsSync(path.join(this.installDir, 'package.json'));
    }

    // Update existing installation
    async update() {
        this.log('Updating existing installation...');
        
        try {
            // Backup current installation
            const backupDir = path.join(os.tmpdir(), `LockedIn_backup_${Date.now()}`);
            if (fs.existsSync(this.installDir)) {
                fs.cpSync(this.installDir, backupDir, { recursive: true });
                this.log(`Created backup at: ${backupDir}`);
            }
            
            // Update files (excluding user data)
            await this.copyFiles();
            await this.installDependencies();
            
            this.log('Update completed successfully');
            return { success: true, message: 'Application updated successfully!' };
            
        } catch (error) {
            this.error(`Update failed: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    // Uninstall the application
    async uninstall() {
        this.log('Starting uninstallation...');
        
        try {
            // Remove installation directory
            if (fs.existsSync(this.installDir)) {
                fs.rmSync(this.installDir, { recursive: true, force: true });
                this.log('Removed installation directory');
            }
            
            // Remove shortcuts
            const shortcuts = [
                path.join(this.startMenuDir, `${this.appName}.lnk`),
                path.join(this.desktopPath, `${this.appName}.lnk`)
            ];
            
            for (const shortcut of shortcuts) {
                if (fs.existsSync(shortcut)) {
                    fs.unlinkSync(shortcut);
                    this.log(`Removed shortcut: ${shortcut}`);
                }
            }
            
            this.log('Uninstallation completed successfully');
            return { success: true, message: 'Application uninstalled successfully!' };
            
        } catch (error) {
            this.error(`Uninstallation failed: ${error.message}`);
            return { success: false, error: error.message };
        }
    }
}

// Command line interface
async function main() {
    const installer = new LockedInInstaller();
    
    const args = process.argv.slice(2);
    const command = args[0] || 'install';
    
    console.log('\n=================================');
    console.log('  Locked In - Focus App Installer');
    console.log('=================================\n');
    
    let result;
    
    switch (command.toLowerCase()) {
        case 'install':
            if (installer.isInstalled()) {
                console.log('Application is already installed.');
                console.log('Use "node installer.js update" to update the installation.');
                console.log('Use "node installer.js uninstall" to remove the application.');
                process.exit(0);
            }
            result = await installer.install();
            break;
            
        case 'update':
            if (!installer.isInstalled()) {
                console.log('Application is not installed. Use "node installer.js install" first.');
                process.exit(1);
            }
            result = await installer.update();
            break;
            
        case 'uninstall':
            if (!installer.isInstalled()) {
                console.log('Application is not installed.');
                process.exit(0);
            }
            result = await installer.uninstall();
            break;
            
        case 'status':
            console.log(`Installation status: ${installer.isInstalled() ? 'INSTALLED' : 'NOT INSTALLED'}`);
            if (installer.isInstalled()) {
                console.log(`Install location: ${installer.installDir}`);
                try {
                    const appInfo = JSON.parse(fs.readFileSync(path.join(installer.installDir, 'app-info.json'), 'utf8'));
                    console.log(`Version: ${appInfo.version}`);
                    console.log(`Install date: ${new Date(appInfo.installDate).toLocaleDateString()}`);
                } catch (e) {
                    console.log('Version: Unknown');
                }
            }
            process.exit(0);
            break;
            
        case 'help':
        case '--help':
        case '-h':
            console.log('Usage: node installer.js [command]');
            console.log('');
            console.log('Commands:');
            console.log('  install    Install the application (default)');
            console.log('  update     Update existing installation');
            console.log('  uninstall  Remove the application');
            console.log('  status     Show installation status');
            console.log('  help       Show this help message');
            console.log('');
            console.log('Examples:');
            console.log('  node installer.js install');
            console.log('  node installer.js update');
            console.log('  node installer.js uninstall');
            process.exit(0);
            break;
            
        default:
            console.error(`Unknown command: ${command}`);
            console.log('Use "node installer.js help" for usage information.');
            process.exit(1);
    }
    
    // Handle result
    if (result) {
        console.log('\n' + '='.repeat(50));
        if (result.success) {
            console.log('✅ SUCCESS: ' + result.message);
            if (result.installPath) {
                console.log(`📁 Installation path: ${result.installPath}`);
            }
        } else {
            console.log('❌ ERROR: ' + result.message);
            if (result.error) {
                console.log('   Details: ' + result.error);
            }
            process.exit(1);
        }
        console.log('='.repeat(50));
    }
}

// Error handling
process.on('uncaughtException', (error) => {
    console.error('\n❌ FATAL ERROR:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('\n❌ UNHANDLED REJECTION:', reason);
    process.exit(1);
});

// Run installer if called directly
if (require.main === module) {
    main().catch((error) => {
        console.error('\n❌ Installation failed:', error.message);
        process.exit(1);
    });
}

module.exports = LockedInInstaller;