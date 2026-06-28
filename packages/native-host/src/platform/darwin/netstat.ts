import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseAddressPort } from "../common.js";
import type { Listener } from "../types.js";

const execFileAsync = promisify(execFile);

export const parseLsofListeners = (output: string): Listener[] => {
  const listeners: Listener[] = [];

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("COMMAND")) continue;

    const parts = line.split(/\s+/);
    const pid = Number(parts[1]);
    const tcpMatch = /\bTCP\s+(?<addressPort>.+?)\s+\(LISTEN\)$/i.exec(line);
    if (!Number.isInteger(pid) || !tcpMatch?.groups?.addressPort) continue;

    const parsed = parseAddressPort(tcpMatch.groups.addressPort);
    if (!parsed) continue;
    listeners.push({ address: parsed.address, port: parsed.port, pid });
  }

  return listeners;
};

export const readTcpListeners = async (): Promise<Listener[]> => {
  const { stdout } = await execFileAsync("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"], {
    maxBuffer: 1024 * 1024 * 4
  });

  return parseLsofListeners(stdout);
};
