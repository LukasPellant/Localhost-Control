import type { HostRequest, KillResult, PortEntry, ScanResult } from "./types.js";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

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
  return isNumber(value.pid) && isNumber(value.port) && value.mode === "force-tree";
};

const hasTerminalParams = (value: unknown): boolean => {
  if (!isObject(value)) return false;
  return (
    (value.projectHint === undefined || isString(value.projectHint)) &&
    (value.commandLine === undefined || isString(value.commandLine))
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
    isNumber(value.port) &&
    isString(value.address) &&
    isNumber(value.pid) &&
    isString(value.processName) &&
    isString(value.detectedKind) &&
    isString(value.confidence) &&
    isBoolean(value.killable)
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
    isNumber(value.pid) &&
    isNumber(value.port) &&
    isBoolean(value.portClosed) &&
    isString(value.message)
  );
};
