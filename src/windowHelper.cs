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
        public static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

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

        static void ActivateApp(string query) {
            if (string.IsNullOrWhiteSpace(query)) {
                Console.WriteLine("false");
                return;
            }

            query = query.Trim().ToLowerInvariant();
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

                        if ((procName.Length > 0 && (procName.Contains(query) || query.Contains(procName))) ||
                            (title.Length > 0 && (title.Contains(query) || query.Contains(title)))) {
                            ShowWindow(hwnd, SW_RESTORE);
                            SetForegroundWindow(hwnd);
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
            int count = 0;

            try {
                Process[] processes = Process.GetProcesses();
                foreach (Process p in processes) {
                    try {
                        string name = p.ProcessName.ToLowerInvariant();
                        string title = "";
                        try { title = p.MainWindowTitle.ToLowerInvariant(); } catch { }
                        string path = "";
                        try { path = p.MainModule.FileName.ToLowerInvariant(); } catch { }

                        bool matches = false;
                        if (name == q || name == q.Replace(".exe", "")) matches = true;
                        else if (name.Contains(q) || q.Contains(name)) matches = true;
                        else if (!string.IsNullOrEmpty(title) && (title.Contains(q) || q.Contains(title))) matches = true;
                        else if (!string.IsNullOrEmpty(path) && path.Contains(q)) matches = true;

                        // Protect critical Windows and Self processes
                        if (matches && !IsProtectedProcess(name)) {
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

                        if (name == q || name == q.Replace(".exe", "") ||
                            name.Contains(q) || q.Contains(name) ||
                            (!string.IsNullOrEmpty(title) && (title.Contains(q) || q.Contains(title))) ||
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
            string p = procName.ToLowerInvariant();
            string[] protectedList = new string[] {
                "electron", "locked-in", "locked-in focus app", "antigravity ide",
                "explorer", "csrss", "smss", "services", "lsass", "winlogon", "dwm",
                "svchost", "taskhostw", "sihost", "system", "idle", "runtimebroker",
                "shellexperiencehost", "searchapp", "textinputhost", "cmd", "powershell",
                "conhost", "node"
            };
            foreach (string prot in protectedList) {
                if (p == prot || p.Contains(prot)) return true;
            }
            return false;
        }

        static string EscapeJson(string s) {
            if (string.IsNullOrEmpty(s)) return "";
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", " ");
        }
    }
}
