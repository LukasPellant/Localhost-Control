import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import type { KillParams, TerminalParams, TerminalResult } from "@localhost-control/shared";

const execFileAsync = promisify(execFile);

export const killProcessTree = async (params: KillParams): Promise<void> => {
  await execFileAsync("taskkill", ["/PID", String(params.pid), "/T", "/F"], {
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });
};

const existingWorkingDirectory = (projectHint: string | undefined): string | undefined => {
  if (!projectHint) return undefined;
  return fs.existsSync(projectHint) ? projectHint : undefined;
};

export const openTerminal = async (params: TerminalParams): Promise<TerminalResult> => {
  const cwd = existingWorkingDirectory(params.projectHint) ?? process.env.USERPROFILE ?? process.cwd();
  const wt = process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Microsoft\\WindowsApps\\wt.exe` : "wt.exe";
  const terminal = fs.existsSync(wt) ? wt : "powershell.exe";
  const args = terminal.endsWith("wt.exe") ? ["-d", cwd] : ["-NoExit", "-Command", `Set-Location -LiteralPath '${cwd.replace(/'/g, "''")}'`];

  try {
    const child = spawn(terminal, args, {
      cwd,
      detached: true,
      stdio: "ignore",
      windowsHide: false
    });
    child.unref();
    return { opened: true, message: `Opened terminal in ${cwd}` };
  } catch (error) {
    return { opened: false, message: error instanceof Error ? error.message : String(error) };
  }
};
