import { darwinAdapter } from "./darwin/index.js";
import { linuxAdapter } from "./linux/index.js";
import type { PlatformAdapter } from "./types.js";
import { windowsAdapter } from "./windows/index.js";

export const getPlatformAdapter = (platform: NodeJS.Platform = process.platform): PlatformAdapter => {
  if (platform === "win32") return windowsAdapter;
  if (platform === "darwin") return darwinAdapter;
  if (platform === "linux") return linuxAdapter;
  throw new Error(`Unsupported platform: ${platform}`);
};

export const readTcpListeners = (): Promise<ReturnType<PlatformAdapter["readTcpListeners"]> extends Promise<infer T> ? T : never> =>
  getPlatformAdapter().readTcpListeners();

export const readProcessMetadata = (pids: Iterable<number>) => getPlatformAdapter().readProcessMetadata(pids);

export const killProcessTree = (params: Parameters<PlatformAdapter["killProcessTree"]>[0]) => getPlatformAdapter().killProcessTree(params);

export const openTerminal = (params: Parameters<PlatformAdapter["openTerminal"]>[0]) => getPlatformAdapter().openTerminal(params);
