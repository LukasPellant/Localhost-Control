import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseAddressPort } from "../common.js";
import type { Listener } from "../types.js";

const execFileAsync = promisify(execFile);

export const parseSsListeners = (output: string): Listener[] => {
  const listeners: Listener[] = [];

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("State")) continue;

    const parts = line.split(/\s+/);
    const localAddress = parts[3];
    const pidMatch = /\bpid=(?<pid>\d+)\b/.exec(line);
    if (!localAddress || !pidMatch?.groups?.pid) continue;

    const parsed = parseAddressPort(localAddress);
    const pid = Number(pidMatch.groups.pid);
    if (!parsed || !Number.isInteger(pid)) continue;

    listeners.push({ address: parsed.address, port: parsed.port, pid });
  }

  return listeners;
};

export const readTcpListeners = async (): Promise<Listener[]> => {
  const { stdout } = await execFileAsync("ss", ["-ltnpH"], {
    maxBuffer: 1024 * 1024 * 4
  });

  return parseSsListeners(stdout);
};
