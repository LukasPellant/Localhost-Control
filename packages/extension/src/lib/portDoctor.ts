import type { PortEntry } from "@localhost-control/shared";
import type { ProjectProfile } from "./projectProfiles";

export type PortDoctorStatus = "ok" | "attention" | "conflict";

export type PortDoctorReport = {
  status: PortDoctorStatus;
  summary: string;
  issues: string[];
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
    return {
      status: "conflict",
      summary: `${duplicateEntries.length + 1} listeners share port ${entry.port}`,
      issues,
      conflictingEntries: duplicateEntries,
      reservedProfile,
      nextFreePort: findNextFreePort(entry.port, entries, profiles)
    };
  }

  if (reservedProfile) {
    return {
      status: "attention",
      summary: `${entry.port} is reserved for ${reservedProfile.name}`,
      issues,
      conflictingEntries: [],
      reservedProfile,
      nextFreePort: findNextFreePort(entry.port, entries, profiles)
    };
  }

  return {
    status: "ok",
    summary: `Port ${entry.port} is clear`,
    issues: [],
    conflictingEntries: [],
    nextFreePort: findNextFreePort(entry.port, entries, profiles)
  };
};
