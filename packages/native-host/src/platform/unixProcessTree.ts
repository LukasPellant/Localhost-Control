import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { KillParams } from "@localhost-control/shared";

const execFileAsync = promisify(execFile);

type UnixSignal = "TERM" | "KILL";

type UnixKillDependencies = {
  readChildren(pid: number): Promise<number[]>;
  sendSignal(pid: number, signal: UnixSignal): Promise<void>;
  sleep(ms: number): Promise<void>;
};

export const isNoChildProcessResult = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const result = error as { code?: unknown; stderr?: unknown; stdout?: unknown };
  return result.code === 1 && (result.stdout === undefined || result.stdout === "") && (result.stderr === undefined || result.stderr === "");
};

const isMissingProcessError = (error: unknown): boolean =>
  isNoChildProcessResult(error) || (error instanceof Error && /No such process|not found|no matching processes/i.test(error.message));

export const readChildPids = async (pid: number): Promise<number[]> => {
  try {
    const { stdout } = await execFileAsync("pgrep", ["-P", String(pid)], { maxBuffer: 1024 * 1024 });
    return stdout
      .split(/\s+/)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
  } catch (error) {
    if (isMissingProcessError(error)) return [];
    throw error;
  }
};

export const sendSignalToPid = async (pid: number, signal: UnixSignal): Promise<void> => {
  try {
    process.kill(pid, `SIG${signal}`);
  } catch (error) {
    if (isMissingProcessError(error)) return;
    throw error;
  }
};

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const collectProcessTree = async (pid: number, readChildren: (pid: number) => Promise<number[]>, seen = new Set<number>()): Promise<number[]> => {
  if (seen.has(pid)) return [];
  seen.add(pid);

  const children = await readChildren(pid);
  const descendants = await Promise.all(children.map((childPid) => collectProcessTree(childPid, readChildren, seen)));
  return [...descendants.flat(), pid];
};

export const createUnixKillProcessTree =
  ({ readChildren, sendSignal, sleep: wait }: UnixKillDependencies) =>
  async (params: KillParams): Promise<void> => {
    const pids = [...new Set(await collectProcessTree(params.pid, readChildren))];

    await Promise.all(pids.map((pid) => sendSignal(pid, "TERM")));
    await wait(250);
    await Promise.all(pids.map((pid) => sendSignal(pid, "KILL")));
  };

export const killUnixProcessTree = createUnixKillProcessTree({
  readChildren: readChildPids,
  sendSignal: sendSignalToPid,
  sleep
});
