using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

namespace LockedInFocusHelper {
    class Program {
        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        public static extern bool BringWindowToTop(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

        [DllImport("kernel32.dll")]
        public static extern uint GetCurrentThreadId();

        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        private const int SW_RESTORE = 9;
        private const int SW_SHOW = 5;

        static void Main(string[] args) {
            string command = args.Length > 0 ? args[0].ToLowerInvariant() : "get-active";
            string param = args.Length > 1 ? string.Join(" ", args, 1, args.Length - 1) : "";

            switch (command) {
                case "get-active":
                    GetActive();
                    break;
                case "get-running":
                    GetRunning();
                    break;
                case "list-windows":
                    ListWindows();
                    break;
                case "activate":
                    ActivateApp(param);
                    break;
                case "kill":
                    KillApp(param);
                    break;
                case "is-running":
                    IsRunning(param);
                    break;
                default:
                    GetActive();
                    break;
            }
        }

        static void GetActive() {
            try {
                IntPtr hwnd = GetForegroundWindow();
                if (hwnd == IntPtr.Zero) {
                    Console.WriteLine("{}");
                    return;
                }

                uint pid = 0;
                GetWindowThreadProcessId(hwnd, out pid);
                string procName = "";
                string procPath = "";

                if (pid > 0) {
                    try {
                        Process p = Process.GetProcessById((int)pid);
                        procName = p.ProcessName;
                        try { procPath = p.MainModule.FileName; } catch { }
                    } catch { }
                }

                StringBuilder sb = new StringBuilder(512);
                GetWindowText(hwnd, sb, 512);

                Console.WriteLine("{{\"pid\":{0},\"processName\":\"{1}\",\"windowTitle\":\"{2}\",\"path\":\"{3}\"}}",
                    pid,
                    EscapeJson(procName),
                    EscapeJson(sb.ToString()),
                    EscapeJson(procPath)
                );
            } catch (Exception ex) {
                Console.WriteLine("{{\"error\":\"{0}\"}}", EscapeJson(ex.Message));
            }
        }

        static void GetRunning() {
            List<string> items = new List<string>();
            try {
                Process[] processes = Process.GetProcesses();
                foreach (Process p in processes) {
                    try {
                        string name = p.ProcessName;
                        string title = "";
                        try { title = p.MainWindowTitle; } catch { }
                        items.Add(string.Format("{{\"pid\":{0},\"name\":\"{1}\",\"title\":\"{2}\"}}",
                            p.Id,
                            EscapeJson(name),
                            EscapeJson(title)
                        ));
                    } catch { }
                }
                Console.WriteLine("[" + string.Join(",", items.ToArray()) + "]");
            } catch {
                Console.WriteLine("[]");
            }
        }

        static void ListWindows() {
            List<string> items = new List<string>();
            try {
                EnumWindows((hwnd, lParam) => {
                    if (IsWindowVisible(hwnd)) {
                        StringBuilder sb = new StringBuilder(512);
                        GetWindowText(hwnd, sb, 512);
                        string title = sb.ToString();

                        if (!string.IsNullOrWhiteSpace(title)) {
                            uint pid = 0;
                            GetWindowThreadProcessId(hwnd, out pid);
                            string procName = "";
                            string procPath = "";

                            if (pid > 0) {
                                try {
                                    Process p = Process.GetProcessById((int)pid);
                                    procName = p.ProcessName;
                                    try { procPath = p.MainModule.FileName; } catch { }
                                } catch { }
                            }

                            items.Add(string.Format("{{\"hwnd\":{0},\"pid\":{1},\"processName\":\"{2}\",\"windowTitle\":\"{3}\",\"path\":\"{4}\"}}",
                                hwnd.ToInt64(),
                                pid,
                                EscapeJson(procName),
                                EscapeJson(title),
                                EscapeJson(procPath)
                            ));
                        }
                    }
                    return true;
                }, IntPtr.Zero);

                Console.WriteLine("[" + string.Join(",", items.ToArray()) + "]");
            } catch {
                Console.WriteLine("[]");
            }
        }

        static void ForceForeground(IntPtr hWnd) {
            if (hWnd == IntPtr.Zero) return;
            try {
                // Windows lock bypass
                keybd_event(0, 0, 0, UIntPtr.Zero);
                ShowWindow(hWnd, SW_RESTORE);

                IntPtr fgWnd = GetForegroundWindow();
                uint fgThread = 0;
                if (fgWnd != IntPtr.Zero) {
                    GetWindowThreadProcessId(fgWnd, out fgThread);
                }
                uint currentThread = GetCurrentThreadId();

                if (fgThread != 0 && fgThread != currentThread) {
                    AttachThreadInput(currentThread, fgThread, true);
                    BringWindowToTop(hWnd);
                    SetForegroundWindow(hWnd);
                    AttachThreadInput(currentThread, fgThread, false);
                } else {
                    BringWindowToTop(hWnd);
                    SetForegroundWindow(hWnd);
                }
            } catch {
                ShowWindow(hWnd, SW_RESTORE);
                SetForegroundWindow(hWnd);
            }
        }

        static string CleanQuery(string q) {
            if (string.IsNullOrWhiteSpace(q)) return "";
            string clean = q.Trim().ToLowerInvariant();
            if (clean.EndsWith(".exe")) clean = clean.Substring(0, clean.Length - 4);
            return clean;
        }

        static string AlphaNumericOnly(string s) {
            if (string.IsNullOrEmpty(s)) return "";
            return Regex.Replace(s.ToLowerInvariant(), @"[^a-z0-9]", "");
        }

        static bool MatchesString(string target, string procName, string title, string path) {
            string q = CleanQuery(target);
            if (string.IsNullOrEmpty(q)) return false;

            string pName = CleanQuery(procName);
            string pTitle = (title ?? "").ToLowerInvariant();
            string pPath = (path ?? "").ToLowerInvariant();

            // 1. Direct equality / substring
            if (!string.IsNullOrEmpty(pName)) {
                if (pName == q || pName.Contains(q) || q.Contains(pName)) return true;
            }

            // 2. Alphanumeric stripped match (e.g. "visualstudiocode" matches "code", "pycharm64" matches "pycharm")
            string qAlpha = AlphaNumericOnly(q);
            string pAlpha = AlphaNumericOnly(pName);
            if (!string.IsNullOrEmpty(qAlpha) && !string.IsNullOrEmpty(pAlpha)) {
                if (qAlpha == pAlpha || qAlpha.Contains(pAlpha) || pAlpha.Contains(qAlpha)) return true;
            }

            // 3. Title match
            if (!string.IsNullOrEmpty(pTitle)) {
                if (pTitle.Contains(q) || (!string.IsNullOrEmpty(qAlpha) && AlphaNumericOnly(pTitle).Contains(qAlpha))) return true;
            }

            // 4. Path match
            if (!string.IsNullOrEmpty(pPath)) {
                if (pPath.Contains(q) || (!string.IsNullOrEmpty(qAlpha) && AlphaNumericOnly(pPath).Contains(qAlpha))) return true;
            }

            return false;
        }

        static void ActivateApp(string query) {
            if (string.IsNullOrWhiteSpace(query)) {
                Console.WriteLine("false");
                return;
            }

            bool activated = false;

            try {
                EnumWindows((hwnd, lParam) => {
                    if (IsWindowVisible(hwnd)) {
                        StringBuilder sb = new StringBuilder(512);
                        GetWindowText(hwnd, sb, 512);
                        string title = sb.ToString();

                        uint pid = 0;
                        GetWindowThreadProcessId(hwnd, out pid);
                        string procName = "";
                        string procPath = "";

                        if (pid > 0) {
                            try {
                                Process p = Process.GetProcessById((int)pid);
                                procName = p.ProcessName;
                                try { procPath = p.MainModule.FileName; } catch { }
                            } catch { }
                        }

                        if (MatchesString(query, procName, title, procPath)) {
                            ForceForeground(hwnd);
                            activated = true;
                            return false; // Stop enumerating
                        }
                    }
                    return true;
                }, IntPtr.Zero);
            } catch { }

            Console.WriteLine(activated ? "true" : "false");
        }

        static void KillApp(string query) {
            if (string.IsNullOrWhiteSpace(query)) {
                Console.WriteLine("0");
                return;
            }

            int count = 0;

            try {
                Process[] processes = Process.GetProcesses();
                foreach (Process p in processes) {
                    try {
                        string name = p.ProcessName;
                        if (IsProtectedProcess(name)) continue;

                        string title = "";
                        try { title = p.MainWindowTitle; } catch { }
                        string path = "";
                        try { path = p.MainModule.FileName; } catch { }

                        if (MatchesString(query, name, title, path)) {
                            p.Kill();
                            count++;
                        }
                    } catch { }
                }
            } catch { }

            Console.WriteLine(count.ToString());
        }

        static void IsRunning(string query) {
            if (string.IsNullOrWhiteSpace(query)) {
                Console.WriteLine("false");
                return;
            }

            bool running = false;

            try {
                Process[] processes = Process.GetProcesses();
                foreach (Process p in processes) {
                    try {
                        string name = p.ProcessName;
                        string title = "";
                        try { title = p.MainWindowTitle; } catch { }
                        string path = "";
                        try { path = p.MainModule.FileName; } catch { }

                        if (MatchesString(query, name, title, path)) {
                            running = true;
                            break;
                        }
                    } catch { }
                }
            } catch { }

            Console.WriteLine(running ? "true" : "false");
        }

        static bool IsProtectedProcess(string procName) {
            if (string.IsNullOrEmpty(procName)) return true;
            string p = procName.ToLowerInvariant();
            string[] exactProtected = new string[] {
                "explorer", "csrss", "smss", "services", "lsass", "winlogon", "dwm",
                "svchost", "taskhostw", "sihost", "system", "idle", "runtimebroker",
                "shellexperiencehost", "searchapp", "textinputhost", "cmd", "powershell", "pwsh",
                "conhost", "node", "electron", "locked-in", "locked-in focus app", "antigravity ide",
                "windowhelper"
            };
            foreach (string prot in exactProtected) {
                if (p == prot) return true;
            }
            if (p.StartsWith("electron") || p.Contains("locked-in") || p.Contains("antigravity")) {
                return true;
            }
            return false;
        }

        static string EscapeJson(string s) {
            if (string.IsNullOrEmpty(s)) return "";
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", " ");
        }
    }
}
