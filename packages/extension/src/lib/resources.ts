import type { ProcessResources } from "@localhost-control/shared";

const BYTES_PER_MIB = 1024 * 1024;

export const formatCpu = (resources: ProcessResources | undefined): string | undefined => {
  if (resources?.cpuPercent === undefined) return undefined;
  const rounded = Math.round(resources.cpuPercent * 10) / 10;
  return `${rounded}% CPU`;
};

export const formatMemory = (bytes: number | undefined, label = "RAM"): string | undefined => {
  if (bytes === undefined) return undefined;
  return `${Math.round(bytes / BYTES_PER_MIB)} MB ${label}`;
};

export const formatUptime = (resources: ProcessResources | undefined): string | undefined => {
  if (resources?.uptimeMs === undefined) return undefined;
  const totalMinutes = Math.max(0, Math.round(resources.uptimeMs / 60_000));
  if (totalMinutes < 60) return `${totalMinutes} min uptime`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${minutes}m uptime` : `${hours}h uptime`;
};

export const compactResourceLabels = (resources: ProcessResources | undefined): string[] =>
  [
    formatCpu(resources),
    formatMemory(resources?.memoryBytes),
    resources?.threadCount !== undefined ? `${resources.threadCount} threads` : undefined
  ].filter((label): label is string => Boolean(label));
