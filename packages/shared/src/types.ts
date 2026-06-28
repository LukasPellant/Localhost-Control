export const HOST_NAME = "com.localhost_control.host" as const;

export type DetectedKind = "vite" | "next" | "convex" | "python" | "node" | "static" | "unknown";
export type Confidence = "high" | "medium" | "low";
export type AppScope = "dev-app" | "local-service" | "protected";

export type ScanParams = {
  includeSystemPorts: boolean;
  httpProbe: boolean;
  maxProbeMs: number;
};

export type KillParams = {
  pid: number;
  port: number;
  mode: "force-tree";
};

export type TerminalParams = {
  projectHint?: string;
  commandLine?: string;
};

export type ProcessResources = {
  cpuPercent?: number;
  memoryBytes?: number;
  privateMemoryBytes?: number;
  threadCount?: number;
  handleCount?: number;
  uptimeMs?: number;
};

export type HostRequest =
  | { id: string; method: "scan"; params: ScanParams }
  | { id: string; method: "kill"; params: KillParams }
  | { id: string; method: "openTerminal"; params: TerminalParams }
  | { id: string; method: "version" };

export type PortEntry = {
  port: number;
  address: "127.0.0.1" | "0.0.0.0" | "::1" | "::" | string;
  pid: number;
  processName: string;
  executablePath?: string;
  commandLine?: string;
  parentPid?: number;
  detectedKind: DetectedKind;
  url?: string;
  title?: string;
  statusCode?: number;
  projectHint?: string;
  resources?: ProcessResources;
  confidence: Confidence;
  killable: boolean;
  protectionReason?: string;
  appScope?: AppScope;
};

export type ScanResult = {
  entries: PortEntry[];
  scannedAt: string;
  durationMs: number;
};

export type KillResult = {
  killed: boolean;
  pid: number;
  port: number;
  portClosed: boolean;
  message: string;
};

export type TerminalResult = {
  opened: boolean;
  message: string;
};

export type VersionResult = {
  version: string;
  platform: string;
};

export type HostError = {
  error: string;
  message: string;
};

export type ClassifyInput = {
  port: number;
  processName?: string;
  commandLine?: string;
  title?: string;
  statusCode?: number;
};

export type Classification = {
  detectedKind: DetectedKind;
  confidence: Confidence;
};

export type ScopePolicy = {
  trustedProjectRoots: string[];
  trustedProjectPaths: string[];
  blockedProcessNames: string[];
};
