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
  resources?: {
    cpuPercent?: number;
    memoryBytes?: number;
    privateMemoryBytes?: number;
    threadCount?: number;
    handleCount?: number;
    uptimeMs?: number;
  };
};

type CimProcess = {
  ProcessId: number;
  ParentProcessId: number;
  Name?: string;
  ExecutablePath?: string;
  CommandLine?: string;
  WorkingSetSize?: number | string;
  PrivatePageCount?: number | string;
  ThreadCount?: number | string;
  HandleCount?: number | string;
  CreationDate?: string;
  PercentProcessorTime?: number | string;
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

  const resources = deriveResources(processInfo);
  if (resources) base.resources = resources;

  return base;
};

const parseCimJson = (stdout: string): CimProcess[] => {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed) as CimProcess | CimProcess[];
  return Array.isArray(parsed) ? parsed : [parsed];
};

const finiteNumber = (value: unknown): number | undefined => {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) && number >= 0 ? number : undefined;
};

const parseCimDate = (value: string | undefined): Date | undefined => {
  if (!value) return undefined;
  const jsonDateMatch = value.match(/\/Date\((\d+)\)\//);
  if (jsonDateMatch?.[1]) return new Date(Number(jsonDateMatch[1]));
  const normalized = value.replace(/\.(\d{3})\d+/, ".$1");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const deriveResources = (processInfo: CimProcess): ProcessMetadata["resources"] | undefined => {
  const resources: NonNullable<ProcessMetadata["resources"]> = {};
  const cpuPercent = finiteNumber(processInfo.PercentProcessorTime);
  const memoryBytes = finiteNumber(processInfo.WorkingSetSize);
  const privateMemoryBytes = finiteNumber(processInfo.PrivatePageCount);
  const threadCount = finiteNumber(processInfo.ThreadCount);
  const handleCount = finiteNumber(processInfo.HandleCount);
  const creationDate = parseCimDate(processInfo.CreationDate);

  if (cpuPercent !== undefined) resources.cpuPercent = Math.round(cpuPercent * 10) / 10;
  if (memoryBytes !== undefined) resources.memoryBytes = memoryBytes;
  if (privateMemoryBytes !== undefined) resources.privateMemoryBytes = privateMemoryBytes;
  if (threadCount !== undefined) resources.threadCount = threadCount;
  if (handleCount !== undefined) resources.handleCount = handleCount;
  if (creationDate) resources.uptimeMs = Math.max(0, Date.now() - creationDate.getTime());

  return Object.keys(resources).length ? resources : undefined;
};

export const readProcessMetadata = async (pids: Iterable<number>): Promise<Map<number, ProcessMetadata>> => {
  const uniquePids = Array.from(new Set(Array.from(pids).filter((pid) => Number.isInteger(pid) && pid > 0)));
  if (uniquePids.length === 0) return new Map();

  const filter = uniquePids.map((pid) => `ProcessId=${pid}`).join(" OR ");
  const pidArray = uniquePids.join(",");
  const command = [
    `$ErrorActionPreference = 'Stop'`,
    `$items = Get-CimInstance Win32_Process -Filter "${filter}"`,
    `$perf = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { @(${pidArray}) -contains $_.IDProcess } | Group-Object IDProcess -AsHashTable -AsString`,
    `$items | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine,WorkingSetSize,PrivatePageCount,ThreadCount,HandleCount,CreationDate,@{Name='PercentProcessorTime';Expression={ $p = $perf[[string]$_.ProcessId]; if ($p) { $p.PercentProcessorTime } }} | ConvertTo-Json -Compress`
  ].join("; ");

  const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-NonInteractive", "-Command", command], {
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 8
  });

  const entries = parseCimJson(stdout).map(toProcessMetadata);
  return new Map(entries.map((entry) => [entry.pid, entry]));
};
