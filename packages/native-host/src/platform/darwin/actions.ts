import { spawn } from "node:child_process";
import fs from "node:fs";
import type { KillParams, TerminalParams, TerminalResult } from "@localhost-control/shared";
import { killUnixProcessTree } from "../unixProcessTree.js";

export const killProcessTree = async (params: KillParams): Promise<void> => killUnixProcessTree(params);

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
