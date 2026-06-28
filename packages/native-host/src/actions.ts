import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import { protectPortEntry, type KillParams, type KillResult, type TerminalParams, type TerminalResult } from "@localhost-control/shared";
import { isPortListening, readTcpListeners, type Listener } from "./netstat.js";
import { readProcessMetadata, type ProcessMetadata } from "./processMetadata.js";

const execFileAsync = promisify(execFile);

const waitForPortClosed = async (port: number): Promise<boolean> => {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (!(await isPortListening(port))) return true;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return !(await isPortListening(port));
};

type KillTargetResolution =
  | { allowed: true }
  | { allowed: false; message: string };

const isPortListeningIn = (listeners: Listener[], port: number): boolean =>
  listeners.some((listener) => listener.port === port);

export const resolveKillTarget = (
  params: KillParams,
  listeners: Listener[],
  metadataByPid: Map<number, ProcessMetadata>
): KillTargetResolution => {
  const listener = listeners.find((item) => item.pid === params.pid && item.port === params.port);
  if (!listener) {
    return {
      allowed: false,
      message: `Refused to kill PID ${params.pid} because it is not the listener on port ${params.port}.`
    };
  }

  const metadata = metadataByPid.get(params.pid);
  const protectionInput = {
    port: listener.port,
    pid: listener.pid,
    processName: metadata?.processName ?? `pid-${listener.pid}`,
    detectedKind: "unknown",
    confidence: "low"
  } as const;
  const protectedEntry = protectPortEntry(
    metadata?.executablePath ? { ...protectionInput, executablePath: metadata.executablePath } : protectionInput
  );

  if (!protectedEntry.killable) {
    return {
      allowed: false,
      message: `Refused to kill PID ${params.pid} on port ${params.port}: ${protectedEntry.protectionReason}.`
    };
  }

  return { allowed: true };
};

export const killProcessTree = async (params: KillParams): Promise<KillResult> => {
  const [listeners, metadataByPid] = await Promise.all([readTcpListeners(), readProcessMetadata([params.pid])]);
  const target = resolveKillTarget(params, listeners, metadataByPid);
  if (!target.allowed) {
    return {
      killed: false,
      pid: params.pid,
      port: params.port,
      portClosed: !isPortListeningIn(listeners, params.port),
      message: target.message
    };
  }

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
