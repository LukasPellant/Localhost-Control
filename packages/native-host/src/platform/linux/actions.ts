import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import type { KillParams, TerminalParams, TerminalResult } from "@localhost-control/shared";

const execFileAsync = promisify(execFile);
const TERMINAL_CANDIDATES = ["xdg-terminal-exec", "gnome-terminal", "konsole", "xfce4-terminal", "xterm"];

export const killProcessTree = async (params: KillParams): Promise<void> => {
  try {
    await execFileAsync("kill", ["-TERM", String(-params.pid)]);
  } catch {
    await execFileAsync("kill", ["-TERM", String(params.pid)]);
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
