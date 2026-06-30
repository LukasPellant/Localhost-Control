import type { PortEntry } from "@localhost-control/shared";
import type { ProjectProfile } from "./projectProfiles";
import { redactSensitiveText, sanitizeLocalUrl } from "./sensitiveText";

export type PortDoctorStatus = "ok" | "attention" | "conflict";

export type PortDoctorReport = {
  status: PortDoctorStatus;
  summary: string;
  issues: string[];
  advice: string[];
  conflictingEntries: PortEntry[];
  reservedProfile?: ProjectProfile | undefined;
  nextFreePort?: number | undefined;
};

const isPortAvailable = (port: number, entries: PortEntry[], profiles: ProjectProfile[]): boolean =>
  !entries.some((entry) => entry.port === port) && !profiles.some((profile) => profile.expectedPort === port);

const findNextFreePort = (startPort: number, entries: PortEntry[], profiles: ProjectProfile[]): number | undefined => {
  for (let port = startPort + 1; port <= 65535; port += 1) {
    if (isPortAvailable(port, entries, profiles)) return port;
  }
  return undefined;
};

const withFallbackPort = (commandLine: string | undefined, currentPort: number, nextFreePort: number | undefined): string | undefined => {
  if (!commandLine) return undefined;
  const trimmed = commandLine.trim();
  if (!trimmed) return undefined;
  if (!nextFreePort) return redactSensitiveText(trimmed);
  const flagWithSpace = new RegExp(`((?:--(?:port|host-port)|-p)\\s+)${currentPort}(\\b|$)`, "i");
  const flagWithEquals = new RegExp(`((?:--(?:port|host-port)|-p)=)${currentPort}(\\b|$)`, "i");
  if (flagWithSpace.test(trimmed)) return redactSensitiveText(trimmed.replace(flagWithSpace, `$1${nextFreePort}$2`));
  if (flagWithEquals.test(trimmed)) return redactSensitiveText(trimmed.replace(flagWithEquals, `$1${nextFreePort}$2`));
  return redactSensitiveText(trimmed);
};

const buildAdvice = (
  entry: PortEntry,
  duplicateEntries: PortEntry[],
  reservedProfile: ProjectProfile | undefined,
  nextFreePort: number | undefined
): string[] => {
  const fallbackCommand = withFallbackPort(entry.commandLine, entry.port, nextFreePort);
  const ownerUrl = sanitizeLocalUrl(entry.url ?? `http://127.0.0.1:${entry.port}`);
  const advice = [
    duplicateEntries.length && ownerUrl ? `Confirm which listener should own ${ownerUrl}.` : undefined,
    duplicateEntries.length && nextFreePort
      ? `Stop PID ${duplicateEntries.map((candidate) => candidate.pid).join(", ")} or move one app to port ${nextFreePort}.`
      : undefined,
    reservedProfile ? `${reservedProfile.name} owns the saved reservation for port ${entry.port}.` : undefined,
    reservedProfile && nextFreePort
      ? `Move this process to port ${nextFreePort} or stop it before starting ${reservedProfile.name}.`
      : undefined,
    fallbackCommand ? `Fallback command: ${fallbackCommand}` : undefined
  ].filter((item): item is string => Boolean(item));
  return advice;
};

export const analyzePortDoctor = (
  entry: PortEntry,
  entries: PortEntry[],
  profiles: ProjectProfile[],
  activeProfileId?: string
): PortDoctorReport => {
  const seenSelectedEntry = { current: false };
  const duplicateEntries = entries.filter((candidate) => {
    if (candidate.port !== entry.port) return false;
    if (candidate.pid !== entry.pid) return true;
    const sameSelectedBinding =
      candidate.address === entry.address && candidate.processName === entry.processName && candidate.commandLine === entry.commandLine;
    if (!seenSelectedEntry.current && sameSelectedBinding) {
      seenSelectedEntry.current = true;
      return false;
    }
    return true;
  });
  const reservedProfile = profiles.find((profile) => profile.expectedPort === entry.port && profile.id !== activeProfileId);
  const issues = [
    ...duplicateEntries.map((candidate) => `PID ${candidate.pid} also listens on port ${entry.port}`),
    ...(reservedProfile ? [`Saved profile ${reservedProfile.name} expects port ${entry.port}.`] : [])
  ];

  if (duplicateEntries.length) {
    const nextFreePort = findNextFreePort(entry.port, entries, profiles);
    return {
      status: "conflict",
      summary: `${duplicateEntries.length + 1} listeners share port ${entry.port}`,
      issues,
      conflictingEntries: duplicateEntries,
      reservedProfile,
      nextFreePort,
      advice: buildAdvice(entry, duplicateEntries, reservedProfile, nextFreePort)
    };
  }

  if (reservedProfile) {
    const nextFreePort = findNextFreePort(entry.port, entries, profiles);
    return {
      status: "attention",
      summary: `${entry.port} is reserved for ${reservedProfile.name}`,
      issues,
      conflictingEntries: [],
      reservedProfile,
      nextFreePort,
      advice: buildAdvice(entry, duplicateEntries, reservedProfile, nextFreePort)
    };
  }

  const nextFreePort = findNextFreePort(entry.port, entries, profiles);
  return {
    status: "ok",
    summary: `Port ${entry.port} is clear`,
    issues: [],
    conflictingEntries: [],
    nextFreePort,
    advice: buildAdvice(entry, duplicateEntries, reservedProfile, nextFreePort)
  };
};

export const formatPortDoctorAdvice = (report: PortDoctorReport): string =>
  [report.summary, report.nextFreePort ? `Next free port: ${report.nextFreePort}` : undefined, ...report.issues, ...report.advice]
    .filter((item): item is string => Boolean(item))
    .join("\n");
