import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseAddressPort } from "../common.js";
import type { Listener } from "../types.js";

const execFileAsync = promisify(execFile);

export const parseNetstatListeners = (output: string): Listener[] => {
  const listeners: Listener[] = [];

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.toUpperCase().startsWith("TCP")) continue;

    const parts = line.split(/\s+/);
    const [, localAddress, , state, pidText] = parts;
    if (!localAddress || state?.toUpperCase() !== "LISTENING" || !pidText) continue;

    const parsed = parseAddressPort(localAddress);
    const pid = Number(pidText);
    if (!parsed || !Number.isInteger(pid)) continue;

    listeners.push({ address: parsed.address, port: parsed.port, pid });
  }

  return listeners;
};

export const readTcpListeners = async (): Promise<Listener[]> => {
  const { stdout } = await execFileAsync("netstat", ["-ano", "-p", "tcp"], {
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 4
  });

  return parseNetstatListeners(stdout);
};
