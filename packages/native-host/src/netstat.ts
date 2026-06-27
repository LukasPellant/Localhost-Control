import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type Listener = {
  address: string;
  port: number;
  pid: number;
};

const parseAddressPort = (value: string): { address: string; port: number } | null => {
  const bracketMatch = /^\[(?<address>.*)]:(?<port>\d+)$/.exec(value);
  if (bracketMatch?.groups?.address && bracketMatch.groups.port) {
    return { address: bracketMatch.groups.address, port: Number(bracketMatch.groups.port) };
  }

  const separatorIndex = value.lastIndexOf(":");
  if (separatorIndex <= 0) return null;

  const address = value.slice(0, separatorIndex);
  const port = Number(value.slice(separatorIndex + 1));
  if (!Number.isInteger(port)) return null;

  return { address, port };
};

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

export const isLocalishListener = (listener: Listener): boolean => {
  if (listener.address === "0.0.0.0" || listener.address === "::") return true;
  if (listener.address === "::1") return true;
  if (listener.address.startsWith("127.")) return true;
  return /^[0-9a-f:]+%?\d*$/i.test(listener.address) === false ? true : listener.address.includes(".");
};

export const isPortListening = async (port: number): Promise<boolean> => {
  const listeners = await readTcpListeners();
  return listeners.some((listener) => listener.port === port);
};
