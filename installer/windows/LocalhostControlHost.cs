using System;
using System.Diagnostics;
using System.IO;

public static class LocalhostControlHost
{
    public static int Main()
    {
        try
        {
            var directory = AppContext.BaseDirectory;
            var hostPathFile = Path.Combine(directory, "host-path.txt");
            if (!File.Exists(hostPathFile))
            {
                throw new FileNotFoundException("Missing host-path.txt next to launcher.", hostPathFile);
            }

            var hostPath = File.ReadAllText(hostPathFile).Trim();
            if (!File.Exists(hostPath))
            {
                throw new FileNotFoundException("Compiled native host JavaScript was not found.", hostPath);
            }

            var startInfo = new ProcessStartInfo
            {
                FileName = "node",
                Arguments = "\"" + hostPath.Replace("\"", "\\\"") + "\"",
                UseShellExecute = false,
                RedirectStandardInput = false,
                RedirectStandardOutput = false,
                RedirectStandardError = false,
                CreateNoWindow = true
            };

            using (var process = Process.Start(startInfo))
            {
                if (process == null)
                {
                    throw new InvalidOperationException("Unable to start node process for native host.");
                }

                process.WaitForExit();
                return process.ExitCode;
            }
        }
        catch (Exception exception)
        {
            var logPath = Path.Combine(Path.GetTempPath(), "localhost-control-host.log");
            File.WriteAllText(logPath, exception.ToString());
            return 1;
        }
    }
}
