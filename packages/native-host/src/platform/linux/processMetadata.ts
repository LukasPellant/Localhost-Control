import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { extractProjectHint, finiteNumber, parseElapsedSeconds } from "../common.js";
import type { ProcessMetadata } from "../types.js";

const execFileAsync = promisify(execFile);

const readProcLink = async (pid: number, name: "cwd" | "exe"): Promise<string | undefined> => {
  try {
    return await fs.readlink(`/proc/${pid}/${name}`);
  } catch {
    return undefined;
  }
};

export const parseLinuxPsOutput = (
  output: string,
  executableByPid = new Map<number, string>(),
  cwdByPid = new Map<number, string>()
): Map<number, ProcessMetadata> => {
  const entries = new Map<number, ProcessMetadata>();

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("PID")) continue;

    const match =
      /^(?<pid>\d+)\s+(?<ppid>\d+)\s+(?<comm>\S+)\s+(?<elapsed>\S+)\s+(?<cpu>[\d.]+)\s+(?<rss>\d+)\s+(?<threads>\d+)\s+(?<command>.+)$/.exec(line);
    if (!match?.groups) continue;

    const { pid: pidText, ppid, comm, elapsed, cpu: cpuText, rss: rssText, threads: threadsText, command } = match.groups;
    if (!pidText || !ppid || !comm || !elapsed || !cpuText || !rssText || !threadsText || !command) continue;

    const pid = Number(pidText);
    const executablePath = executableByPid.get(pid);
    const cwd = cwdByPid.get(pid);
    const commandLine = command;
    const elapsedSeconds = parseElapsedSeconds(elapsed);
    const resources: NonNullable<ProcessMetadata["resources"]> = {};
    const cpu = finiteNumber(cpuText);
    const rss = finiteNumber(rssText);
    const threads = finiteNumber(threadsText);

    if (cpu !== undefined) resources.cpuPercent = Math.round(cpu * 10) / 10;
    if (rss !== undefined) resources.memoryBytes = rss * 1024;
    if (threads !== undefined) resources.threadCount = threads;
    if (elapsedSeconds !== undefined) resources.uptimeMs = elapsedSeconds * 1000;

    const entry: ProcessMetadata = {
      pid,
      parentPid: Number(ppid),
      processName: comm
    };
    if (executablePath) entry.executablePath = executablePath;
    if (commandLine) entry.commandLine = commandLine;
    const projectHint = extractProjectHint(commandLine, executablePath, cwd);
    if (projectHint) entry.projectHint = projectHint;
    if (Object.keys(resources).length) entry.resources = resources;

    entries.set(pid, entry);
  }

  return entries;
};

export const readProcessMetadata = async (pids: Iterable<number>): Promise<Map<number, ProcessMetadata>> => {
  const uniquePids = Array.from(new Set(Array.from(pids).filter((pid) => Number.isInteger(pid) && pid > 0)));
  if (uniquePids.length === 0) return new Map();

  const [procLinks, { stdout }] = await Promise.all([
    Promise.all(
      uniquePids.map(async (pid) => ({
        pid,
        executablePath: await readProcLink(pid, "exe"),
        cwd: await readProcLink(pid, "cwd")
      }))
    ),
    execFileAsync("ps", ["-p", uniquePids.join(","), "-o", "pid=", "-o", "ppid=", "-o", "comm=", "-o", "etimes=", "-o", "%cpu=", "-o", "rss=", "-o", "nlwp=", "-o", "args="], {
      maxBuffer: 1024 * 1024 * 8
    })
  ]);

  const executableByPid = new Map(procLinks.flatMap((entry) => (entry.executablePath ? [[entry.pid, entry.executablePath] as const] : [])));
  const cwdByPid = new Map(procLinks.flatMap((entry) => (entry.cwd ? [[entry.pid, entry.cwd] as const] : [])));
  return parseLinuxPsOutput(stdout, executableByPid, cwdByPid);
};
