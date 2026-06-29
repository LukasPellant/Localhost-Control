import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import type { KillParams, TerminalParams, TerminalResult } from "@localhost-control/shared";

const execFileAsync = promisify(execFile);
const TERMINAL_CANDIDATES = ["xdg-terminal-exec", "gnome-terminal", "konsole", "xfce4-terminal", "xterm"];

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

const findTerminal = (): string => TERMINAL_CANDIDATES.find((candidate) => candidate === "xdg-terminal-exec" || fs.existsSync(`/usr/bin/${candidate}`)) ?? "xterm";

export const openTerminal = async (params: TerminalParams): Promise<TerminalResult> => {
  const cwd = existingWorkingDirectory(params.projectHint) ?? process.env.HOME ?? process.cwd();
  const terminal = findTerminal();
  const args = terminal === "gnome-terminal" || terminal === "xfce4-terminal" ? ["--working-directory", cwd] : [];

  try {
    const child = spawn(terminal, args, {
      cwd,
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    return { opened: true, message: `Opened terminal in ${cwd}` };
  } catch (error) {
    return { opened: false, message: error instanceof Error ? error.message : String(error) };
  }
};
