import path from "node:path";
import type { Listener } from "./types.js";

export const parseAddressPort = (value: string): { address: string; port: number } | null => {
  const normalized = value.trim();
  const bracketMatch = /^\[(?<address>.*)]:(?<port>\d+)$/.exec(normalized);
  if (bracketMatch?.groups?.address && bracketMatch.groups.port) {
    return { address: normalizeAddress(bracketMatch.groups.address), port: Number(bracketMatch.groups.port) };
  }

  const separatorIndex = normalized.lastIndexOf(":");
  if (separatorIndex <= 0) return null;

  const address = normalized.slice(0, separatorIndex);
  const port = Number(normalized.slice(separatorIndex + 1));
  if (!Number.isInteger(port)) return null;

  return { address: normalizeAddress(address), port };
};

export const normalizeAddress = (address: string): string => {
  const clean = address.replace(/^\[(.*)]$/, "$1");
  if (clean === "*" || clean === "0.0.0.0") return "0.0.0.0";
  if (clean === "::" || clean === "[::]") return "::";
  if (clean === "localhost") return "127.0.0.1";
  return clean;
};

export const isLocalishListener = (listener: Listener): boolean => {
  if (listener.address === "0.0.0.0" || listener.address === "::") return true;
  if (listener.address === "::1") return true;
  if (listener.address.startsWith("127.")) return true;
  return false;
};

export const finiteNumber = (value: unknown): number | undefined => {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) && number >= 0 ? number : undefined;
};

export const parseElapsedSeconds = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);

  const dayMatch = /^(?<days>\d+)-(?<time>\d{1,2}:\d{2}:\d{2})$/.exec(trimmed);
  const timeText = dayMatch?.groups?.time ?? trimmed;
  const parts = timeText.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return undefined;

  const [hours = 0, minutes = 0, seconds = 0] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
  const days = dayMatch?.groups?.days ? Number(dayMatch.groups.days) : 0;
  return days * 86_400 + hours * 3_600 + minutes * 60 + seconds;
};

export const extractProjectHint = (commandLine: string | undefined, executablePath?: string, cwd?: string): string | undefined => {
  if (cwd) return cwd;
  if (commandLine) {
    const nodeModulesIndex = commandLine.indexOf("/node_modules/");
    if (nodeModulesIndex > 0) {
      const beforeNodeModules = commandLine.slice(0, nodeModulesIndex);
      const pathStart = Math.max(beforeNodeModules.lastIndexOf(" "), beforeNodeModules.lastIndexOf("'"), beforeNodeModules.lastIndexOf('"')) + 1;
      return beforeNodeModules.slice(pathStart);
    }

    const packageMatch = commandLine.match(/(?:^|\s)(\/[^ "'<>|]+\/package\.json)\b/);
    if (packageMatch?.[1]) return path.dirname(packageMatch[1]);
  }

  if (executablePath && !executablePath.startsWith("/usr/bin/") && !executablePath.startsWith("/bin/")) {
    return path.dirname(executablePath);
  }

  return undefined;
};
