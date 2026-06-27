using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

public static class LocalhostControlHost
{
    private static void CopyStream(Stream source, Stream destination, bool closeDestination)
    {
        var buffer = new byte[81920];

        try
        {
            int bytesRead;
            while ((bytesRead = source.Read(buffer, 0, buffer.Length)) > 0)
            {
                destination.Write(buffer, 0, bytesRead);
                destination.Flush();
            }
        }
        catch
        {
            // The browser can close native messaging pipes at any time.
        }
        finally
        {
            if (closeDestination)
            {
                try
                {
                    destination.Close();
                }
                catch
                {
                }
            }
        }
    }

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
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };

            using (var process = Process.Start(startInfo))
            {
                if (process == null)
                {
                    throw new InvalidOperationException("Unable to start node process for native host.");
                }

                var inputThread = new Thread(() =>
                    CopyStream(Console.OpenStandardInput(), process.StandardInput.BaseStream, true));
                var outputThread = new Thread(() =>
                    CopyStream(process.StandardOutput.BaseStream, Console.OpenStandardOutput(), false));
                var errorThread = new Thread(() =>
                {
                    try
                    {
                        var error = process.StandardError.ReadToEnd();
                        if (!string.IsNullOrWhiteSpace(error))
                        {
                            File.AppendAllText(Path.Combine(Path.GetTempPath(), "localhost-control-host.log"), error);
                        }
                    }
                    catch
                    {
                    }
                });

                inputThread.IsBackground = true;
                outputThread.IsBackground = true;
                errorThread.IsBackground = true;
                inputThread.Start();
                outputThread.Start();
                errorThread.Start();

                process.WaitForExit();
                outputThread.Join(1000);
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
