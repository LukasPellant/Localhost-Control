import type { KillParams, TerminalParams, TerminalResult } from "@localhost-control/shared";

export type Listener = {
  address: string;
  port: number;
  pid: number;
};

export type ProcessMetadata = {
  pid: number;
  parentPid: number;
  processName: string;
  executablePath?: string;
  commandLine?: string;
  projectHint?: string;
  resources?: {
    cpuPercent?: number;
    memoryBytes?: number;
    privateMemoryBytes?: number;
    threadCount?: number;
    handleCount?: number;
    uptimeMs?: number;
  };
};

export type PlatformAdapter = {
  readTcpListeners(): Promise<Listener[]>;
  readProcessMetadata(pids: Iterable<number>): Promise<Map<number, ProcessMetadata>>;
  killProcessTree(params: KillParams): Promise<void>;
  openTerminal(params: TerminalParams): Promise<TerminalResult>;
};
