import type { HostRequest, KillResult, PortEntry, ScanResult } from "./types.js";

const detectedKinds = new Set(["vite", "next", "convex", "python", "node", "static", "unknown"]);
const confidenceLevels = new Set(["high", "medium", "low"]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const isPositiveInteger = (value: unknown): value is number => isNumber(value) && Number.isInteger(value) && value > 0;
const isTcpPort = (value: unknown): value is number => isPositiveInteger(value) && value <= 65535;

const hasScanParams = (value: unknown): boolean => {
  if (!isObject(value)) return false;
  return (
    isBoolean(value.includeSystemPorts) &&
    isBoolean(value.httpProbe) &&
    isNumber(value.maxProbeMs) &&
    value.maxProbeMs >= 50 &&
    value.maxProbeMs <= 5000
  );
};

const hasKillParams = (value: unknown): boolean => {
  if (!isObject(value)) return false;
  return isPositiveInteger(value.pid) && isTcpPort(value.port) && value.mode === "force-tree";
};

const hasTerminalParams = (value: unknown): boolean => {
  if (!isObject(value)) return false;
  return (
    (value.projectHint === undefined || isString(value.projectHint)) &&
    (value.commandLine === undefined || isString(value.commandLine))
  );
};

const isOptionalNumber = (value: unknown): boolean => value === undefined || isNumber(value);
const isOptionalString = (value: unknown): boolean => value === undefined || isString(value);
const isOptionalPositiveInteger = (value: unknown): boolean => value === undefined || isPositiveInteger(value);
const isDetectedKind = (value: unknown): boolean => isString(value) && detectedKinds.has(value);
const isConfidence = (value: unknown): boolean => isString(value) && confidenceLevels.has(value);

const isProcessResources = (value: unknown): boolean => {
  if (!isObject(value)) return false;
  return (
    isOptionalNumber(value.cpuPercent) &&
    isOptionalNumber(value.memoryBytes) &&
    isOptionalNumber(value.privateMemoryBytes) &&
    isOptionalNumber(value.threadCount) &&
    isOptionalNumber(value.handleCount) &&
    isOptionalNumber(value.uptimeMs)
  );
};

export const isHostRequest = (value: unknown): value is HostRequest => {
  if (!isObject(value) || !isString(value.id) || !isString(value.method)) return false;

  switch (value.method) {
    case "scan":
      return hasScanParams(value.params);
    case "kill":
      return hasKillParams(value.params);
    case "openTerminal":
      return hasTerminalParams(value.params);
    case "version":
      return value.params === undefined;
    default:
      return false;
  }
};

const isPortEntry = (value: unknown): value is PortEntry => {
  if (!isObject(value)) return false;
  return (
    isTcpPort(value.port) &&
    isString(value.address) &&
    isPositiveInteger(value.pid) &&
    isString(value.processName) &&
    isDetectedKind(value.detectedKind) &&
    isConfidence(value.confidence) &&
    isBoolean(value.killable) &&
    isOptionalString(value.executablePath) &&
    isOptionalString(value.commandLine) &&
    isOptionalPositiveInteger(value.parentPid) &&
    isOptionalString(value.url) &&
    isOptionalString(value.title) &&
    isOptionalNumber(value.statusCode) &&
    isOptionalString(value.projectHint) &&
    isOptionalString(value.protectionReason) &&
    (value.resources === undefined || isProcessResources(value.resources))
  );
};

export const isScanResult = (value: unknown): value is ScanResult => {
  if (!isObject(value)) return false;
  return Array.isArray(value.entries) && value.entries.every(isPortEntry) && isString(value.scannedAt) && isNumber(value.durationMs);
};

export const isKillResult = (value: unknown): value is KillResult => {
  if (!isObject(value)) return false;
  return (
    isBoolean(value.killed) &&
    isPositiveInteger(value.pid) &&
    isTcpPort(value.port) &&
    isBoolean(value.portClosed) &&
    isString(value.message)
  );
};
