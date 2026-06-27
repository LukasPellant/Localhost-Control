import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ProcessMetadata = {
  pid: number;
  parentPid: number;
  processName: string;
  executablePath?: string;
  commandLine?: string;
  projectHint?: string;
};

type CimProcess = {
  ProcessId: number;
  ParentProcessId: number;
  Name?: string;
  ExecutablePath?: string;
  CommandLine?: string;
};

const extractWindowsPath = (commandLine: string): string | undefined => {
  const matches = commandLine.match(/[A-Z]:\\(?:[^ "'<>|]+|[ ][^ "'<>|]+)+/gi) ?? [];
  for (const match of matches) {
    const normalized = match.replace(/["']/g, "");
    const lower = normalized.toLowerCase();
    if (lower.includes("\\node_modules\\")) {
      return normalized.slice(0, lower.indexOf("\\node_modules\\"));
    }
    if (lower.endsWith("\\package.json")) return path.dirname(normalized);
    if (!lower.startsWith("c:\\program files") && !lower.startsWith("c:\\windows")) {
      return path.extname(normalized) ? path.dirname(normalized) : normalized;
    }
  }
  return undefined;
};

const deriveProjectHint = (processInfo: CimProcess): string | undefined => {
  if (processInfo.CommandLine) {
    const fromCommand = extractWindowsPath(processInfo.CommandLine);
    if (fromCommand) return fromCommand;
  }

  if (processInfo.ExecutablePath) {
    const lower = processInfo.ExecutablePath.toLowerCase();
    if (!lower.startsWith("c:\\windows\\") && !lower.startsWith("c:\\program files\\")) {
      return path.dirname(processInfo.ExecutablePath);
    }
  }

  return undefined;
};

const toProcessMetadata = (processInfo: CimProcess): ProcessMetadata => {
  const base: ProcessMetadata = {
    pid: Number(processInfo.ProcessId),
    parentPid: Number(processInfo.ParentProcessId ?? 0),
    processName: processInfo.Name ?? `pid-${processInfo.ProcessId}`
  };

  if (processInfo.ExecutablePath) base.executablePath = processInfo.ExecutablePath;
  if (processInfo.CommandLine) base.commandLine = processInfo.CommandLine;

  const projectHint = deriveProjectHint(processInfo);
  if (projectHint) base.projectHint = projectHint;

  return base;
};

const parseCimJson = (stdout: string): CimProcess[] => {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed) as CimProcess | CimProcess[];
  return Array.isArray(parsed) ? parsed : [parsed];
};

export const readProcessMetadata = async (pids: Iterable<number>): Promise<Map<number, ProcessMetadata>> => {
  const uniquePids = Array.from(new Set(Array.from(pids).filter((pid) => Number.isInteger(pid) && pid > 0)));
  if (uniquePids.length === 0) return new Map();

  const filter = uniquePids.map((pid) => `ProcessId=${pid}`).join(" OR ");
  const command = [
    `$ErrorActionPreference = 'Stop'`,
    `$items = Get-CimInstance Win32_Process -Filter "${filter}"`,
    `$items | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress`
  ].join("; ");

  const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-NonInteractive", "-Command", command], {
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 8
  });

  const entries = parseCimJson(stdout).map(toProcessMetadata);
  return new Map(entries.map((entry) => [entry.pid, entry]));
};
