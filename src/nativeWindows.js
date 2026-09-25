const { exec, execFile, spawn } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');

const execPromise = util.promisify(exec);
const execFilePromise = util.promisify(execFile);

// PowerShell script to get the foreground window
const GET_FOREGROUND_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinApiHelper {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
}
"@ -ErrorAction SilentlyContinue

$hwnd = [WinApiHelper]::GetForegroundWindow()
if ($hwnd -ne [IntPtr]::Zero) {
    $procId = 0
    [WinApiHelper]::GetWindowThreadProcessId($hwnd, [ref]$procId)
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    $sb = New-Object System.Text.StringBuilder 256
    [WinApiHelper]::GetWindowText($hwnd, $sb, 256)
    
    [PSCustomObject]@{
        Hwnd = $hwnd.ToInt64()
        ProcessId = $procId
        ProcessName = if ($proc) { $proc.ProcessName } else { "" }
        MainWindowTitle = $sb.ToString()
        Path = if ($proc) { $proc.Path } else { "" }
    } | ConvertTo-Json -Compress
} else {
    "{}"
}
`;

// PowerShell script to bring process to foreground
const ACTIVATE_APP_SCRIPT = (appName) => `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinApiActivator {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@ -ErrorAction SilentlyContinue

$procs = Get-Process | Where-Object { 
    ($_.ProcessName -like "*${appName}*" -or $_.MainWindowTitle -like "*${appName}*") -and $_.MainWindowHandle -ne [IntPtr]::Zero 
}
foreach ($p in $procs) {
    [WinApiActivator]::ShowWindow($p.MainWindowHandle, 9) # SW_RESTORE
    [WinApiActivator]::SetForegroundWindow($p.MainWindowHandle)
}
`;

class NativeWindowsHelper {
    static async getForegroundWindow() {
        if (process.platform !== 'win32') {
            return null;
        }

        try {
            const encoded = Buffer.from(GET_FOREGROUND_SCRIPT, 'utf16le').toString('base64');
            const { stdout } = await execFilePromise('powershell.exe', [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy', 'Bypass',
                '-EncodedCommand', encoded
            ], { timeout: 3000 });

            if (stdout && stdout.trim()) {
                const parsed = JSON.parse(stdout.trim());
                if (parsed.ProcessName) {
                    return {
                        name: parsed.ProcessName,
                        title: parsed.MainWindowTitle || '',
                        path: parsed.Path || '',
                        pid: parsed.ProcessId
                    };
                }
            }
        } catch (e) {
            // Fallback to tasklist / Get-Process if C# reflection fails
            try {
                const { stdout } = await execPromise('powershell -NoProfile "Get-Process | Where-Object {$_.MainWindowHandle -ne 0} | Select-Object -First 1 ProcessName, MainWindowTitle | ConvertTo-Json -Compress"', { timeout: 2500 });
                const parsed = JSON.parse(stdout.trim());
                if (parsed.ProcessName) {
                    return {
                        name: parsed.ProcessName,
                        title: parsed.MainWindowTitle || '',
                        path: '',
                        pid: 0
                    };
                }
            } catch (err) {
                // Ignore fallback error
            }
        }
        return null;
    }

    static async activateApp(appName) {
        if (process.platform !== 'win32') return false;
        try {
            const cleanName = appName.replace(/\.exe$/i, '').replace(/[^a-zA-Z0-9_\-]/g, '');
            if (!cleanName) return false;
            const script = ACTIVATE_APP_SCRIPT(cleanName);
            const encoded = Buffer.from(script, 'utf16le').toString('base64');
            await execFilePromise('powershell.exe', [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy', 'Bypass',
                '-EncodedCommand', encoded
            ], { timeout: 3000 });
            return true;
        } catch (e) {
            return false;
        }
    }

    static async isProcessRunning(appName) {
        if (process.platform !== 'win32') return false;
        try {
            const cleanName = appName.replace(/\.exe$/i, '');
            const { stdout } = await execPromise(`powershell -NoProfile "(Get-Process -Name '${cleanName}' -ErrorAction SilentlyContinue).Count"`, { timeout: 2500 });
            const count = parseInt(stdout.trim(), 10);
            return count > 0;
        } catch (e) {
            return false;
        }
    }

    static async killProcess(appName) {
        if (process.platform !== 'win32') return false;
        try {
            const baseName = appName.replace(/\.exe$/i, '');
            await execPromise(`taskkill /F /IM "${baseName}.exe" /T`, { timeout: 3000 }).catch(() => {});
            await execPromise(`taskkill /F /IM "${baseName}" /T`, { timeout: 3000 }).catch(() => {});
            return true;
        } catch (e) {
            return false;
        }
    }

    static async launchApp(appNameOrPath) {
        try {
            if (process.platform === 'win32') {
                // If it's a full path or file
                if (fs.existsSync(appNameOrPath)) {
                    spawn('cmd.exe', ['/c', 'start', '""', appNameOrPath], {
                        detached: true,
                        stdio: 'ignore'
                    }).unref();
                    return true;
                }

                // If it's a protocol / app alias / system command
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
            console.error(`Error launching app ${appNameOrPath}:`, e);
            return false;
        }
    }
}

module.exports = NativeWindowsHelper;
