import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import type { KillParams, KillResult, TerminalParams, TerminalResult } from "@localhost-control/shared";
import { isPortListening } from "./netstat.js";

const execFileAsync = promisify(execFile);

const waitForPortClosed = async (port: number): Promise<boolean> => {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (!(await isPortListening(port))) return true;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return !(await isPortListening(port));
};

export const killProcessTree = async (params: KillParams): Promise<KillResult> => {
  try {
    await execFileAsync("taskkill", ["/PID", String(params.pid), "/T", "/F"], {
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });
    const portClosed = await waitForPortClosed(params.port);
    return {
      killed: true,
      pid: params.pid,
      port: params.port,
      portClosed,
      message: portClosed ? `Killed PID ${params.pid}; port ${params.port} is closed.` : `Killed PID ${params.pid}; port ${params.port} is still listening.`
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      killed: false,
      pid: params.pid,
      port: params.port,
      portClosed: !(await isPortListening(params.port)),
      message
    };
  }
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
