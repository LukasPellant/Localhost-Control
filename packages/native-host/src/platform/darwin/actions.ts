import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import type { KillParams, TerminalParams, TerminalResult } from "@localhost-control/shared";

const execFileAsync = promisify(execFile);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const killSignal = async (pid: number, signal: "-TERM" | "-KILL"): Promise<void> => {
  try {
    await execFileAsync("kill", [signal, String(-pid)]);
  } catch {
    await execFileAsync("kill", [signal, String(pid)]);
  }
};

export const killProcessTree = async (params: KillParams): Promise<void> => {
  try {
    await killSignal(params.pid, "-TERM");
    await sleep(250);
    await killSignal(params.pid, "-KILL");
  } catch (error) {
    if (error instanceof Error && /No such process/i.test(error.message)) return;
    throw error;
  }
};

const existingWorkingDirectory = (projectHint: string | undefined): string | undefined => {
  if (!projectHint) return undefined;
  return fs.existsSync(projectHint) ? projectHint : undefined;
};

export const openTerminal = async (params: TerminalParams): Promise<TerminalResult> => {
  const cwd = existingWorkingDirectory(params.projectHint) ?? process.env.HOME ?? process.cwd();

  try {
    const child = spawn("open", ["-a", "Terminal", cwd], {
      cwd,
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    return { opened: true, message: `Opened Terminal in ${cwd}` };
  } catch (error) {
    return { opened: false, message: error instanceof Error ? error.message : String(error) };
  }
};
