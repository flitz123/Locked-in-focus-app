using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

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

        static void ActivateApp(string query) {
            if (string.IsNullOrWhiteSpace(query)) {
                Console.WriteLine("false");
                return;
            }

            string q = query.Trim().ToLowerInvariant();
            if (q.EndsWith(".exe")) q = q.Substring(0, q.Length - 4);
            bool activated = false;

            try {
                EnumWindows((hwnd, lParam) => {
                    if (IsWindowVisible(hwnd)) {
                        StringBuilder sb = new StringBuilder(512);
                        GetWindowText(hwnd, sb, 512);
                        string title = sb.ToString().ToLowerInvariant();

                        uint pid = 0;
                        GetWindowThreadProcessId(hwnd, out pid);
                        string procName = "";

                        if (pid > 0) {
                            try {
                                Process p = Process.GetProcessById((int)pid);
                                procName = p.ProcessName.ToLowerInvariant();
                            } catch { }
                        }

                        if ((procName.Length > 0 && (procName == q || procName.Contains(q) || q.Contains(procName))) ||
                            (title.Length > 0 && (title.Contains(q) || q.Contains(title)))) {
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

            string q = query.Trim().ToLowerInvariant();
            if (q.EndsWith(".exe")) q = q.Substring(0, q.Length - 4);
            int count = 0;

            try {
                Process[] processes = Process.GetProcesses();
                foreach (Process p in processes) {
                    try {
                        string name = p.ProcessName.ToLowerInvariant();
                        if (IsProtectedProcess(name)) continue;

                        string title = "";
                        try { title = p.MainWindowTitle.ToLowerInvariant(); } catch { }
                        string path = "";
                        try { path = p.MainModule.FileName.ToLowerInvariant(); } catch { }

                        bool matches = false;
                        if (name == q) matches = true;
                        else if (name.Contains(q) || q.Contains(name)) matches = true;
                        else if (!string.IsNullOrEmpty(title) && title.Contains(q)) matches = true;
                        else if (!string.IsNullOrEmpty(path) && path.Contains(q)) matches = true;

                        if (matches) {
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

            string q = query.Trim().ToLowerInvariant();
            if (q.EndsWith(".exe")) q = q.Substring(0, q.Length - 4);
            bool running = false;

            try {
                Process[] processes = Process.GetProcesses();
                foreach (Process p in processes) {
                    try {
                        string name = p.ProcessName.ToLowerInvariant();
                        string title = "";
                        try { title = p.MainWindowTitle.ToLowerInvariant(); } catch { }
                        string path = "";
                        try { path = p.MainModule.FileName.ToLowerInvariant(); } catch { }

                        if (name == q || name.Contains(q) || q.Contains(name) ||
                            (!string.IsNullOrEmpty(title) && title.Contains(q)) ||
                            (!string.IsNullOrEmpty(path) && path.Contains(q))) {
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
