import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { extractProjectHint, finiteNumber, parseElapsedSeconds } from "../common.js";
import type { ProcessMetadata } from "../types.js";

const execFileAsync = promisify(execFile);

export const parseDarwinPsOutput = (
  output: string,
  executableByPid = new Map<number, string>()
): Map<number, ProcessMetadata> => {
  const entries = new Map<number, ProcessMetadata>();

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("PID")) continue;

    const matchWithThreads =
      /^(?<pid>\d+)\s+(?<ppid>\d+)\s+(?<comm>\S+)\s+(?<elapsed>\S+)\s+(?<cpu>[\d.]+)\s+(?<rss>\d+)\s+(?<threads>\d+)\s+(?<command>.+)$/.exec(line);
    const matchWithoutThreads =
      /^(?<pid>\d+)\s+(?<ppid>\d+)\s+(?<comm>\S+)\s+(?<elapsed>\S+)\s+(?<cpu>[\d.]+)\s+(?<rss>\d+)\s+(?<command>.+)$/.exec(line);
    const groups = matchWithThreads?.groups ?? matchWithoutThreads?.groups;
    if (!groups) continue;

    const { pid: pidText, ppid, comm, elapsed, cpu: cpuText, rss: rssText, threads: threadsText, command } = groups;
    if (!pidText || !ppid || !comm || !elapsed || !cpuText || !rssText || !command) continue;

    const pid = Number(pidText);
    const executablePath = executableByPid.get(pid);
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
    const projectHint = extractProjectHint(commandLine, executablePath);
    if (projectHint) entry.projectHint = projectHint;
    if (Object.keys(resources).length) entry.resources = resources;

    entries.set(pid, entry);
  }

  return entries;
};

export const readProcessMetadata = async (pids: Iterable<number>): Promise<Map<number, ProcessMetadata>> => {
  const uniquePids = Array.from(new Set(Array.from(pids).filter((pid) => Number.isInteger(pid) && pid > 0)));
  if (uniquePids.length === 0) return new Map();

  const { stdout } = await execFileAsync(
    "ps",
    ["-p", uniquePids.join(","), "-o", "pid=", "-o", "ppid=", "-o", "comm=", "-o", "etime=", "-o", "%cpu=", "-o", "rss=", "-o", "command="],
    { maxBuffer: 1024 * 1024 * 8 }
  );

  return parseDarwinPsOutput(stdout);
};
