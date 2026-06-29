import type { PortEntry } from "@localhost-control/shared";

export type ProjectProfileUrl = {
  label: string;
  url: string;
};

export type ProjectProfile = {
  id: string;
  name: string;
  icon?: string;
  projectPath?: string;
  startCommand?: string;
  expectedPort?: number;
  mainUrl?: string;
  extraUrls?: ProjectProfileUrl[];
  healthUrl?: string;
  preferredOpenMode?: "tab" | "window";
  notes?: string;
  logLines?: string[];
};

export type ProfileMatch = {
  profile: ProjectProfile;
  score: number;
};

export type ProfileState = {
  profile: ProjectProfile;
  status: "running" | "starting" | "unhealthy" | "stopped";
  entry?: PortEntry | undefined;
  healthLabel: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isNonEmptyString = (value: unknown): value is string => isString(value) && value.trim().length > 0;
const isTcpPort = (value: unknown): value is number => Number.isInteger(value) && Number(value) > 0 && Number(value) <= 65535;
const normalizePath = (value: string): string =>
  value
    .trim()
    .replace(/\//g, "\\")
    .replace(/\\+$/, "")
    .toLowerCase();

const normalizeUrl = (value: string): string => {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim().replace(/\/$/, "").toLowerCase();
  }
};

const pathMatches = (candidate: string | undefined, profilePath: string | undefined): boolean => {
  if (!candidate || !profilePath) return false;
  const normalizedCandidate = normalizePath(candidate);
  const normalizedProfilePath = normalizePath(profilePath);
  return normalizedCandidate === normalizedProfilePath || normalizedCandidate.startsWith(`${normalizedProfilePath}\\`);
};

const urlMatches = (entryUrl: string | undefined, profileUrl: string | undefined): boolean =>
  Boolean(entryUrl && profileUrl && normalizeUrl(entryUrl) === normalizeUrl(profileUrl));

const sanitizeUrlList = (value: unknown): ProjectProfileUrl[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const urls = value.flatMap((item): ProjectProfileUrl[] => {
    if (!isRecord(item) || !isNonEmptyString(item.label) || !isNonEmptyString(item.url)) return [];
    return [{ label: item.label.trim(), url: item.url.trim() }];
  });
  return urls.length ? urls : undefined;
};

const sanitizeStringList = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter(isNonEmptyString).map((item) => item.trim());
  return items.length ? items : undefined;
};

const optionalString = (value: unknown): string | undefined => (isNonEmptyString(value) ? value.trim() : undefined);

export const sanitizeProjectProfiles = (value: unknown): ProjectProfile[] => {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item): ProjectProfile[] => {
    if (!isRecord(item) || !isNonEmptyString(item.id) || !isNonEmptyString(item.name)) return [];

    const profile: ProjectProfile = {
      id: item.id.trim(),
      name: item.name.trim()
    };
    const icon = optionalString(item.icon);
    const projectPath = optionalString(item.projectPath);
    const startCommand = optionalString(item.startCommand);
    const mainUrl = optionalString(item.mainUrl);
    const healthUrl = optionalString(item.healthUrl);
    const notes = optionalString(item.notes);
    const extraUrls = sanitizeUrlList(item.extraUrls);
    const logLines = sanitizeStringList(item.logLines);

    if (icon) profile.icon = icon;
    if (projectPath) profile.projectPath = projectPath;
    if (startCommand) profile.startCommand = startCommand;
    if (isTcpPort(item.expectedPort)) profile.expectedPort = item.expectedPort;
    if (mainUrl) profile.mainUrl = mainUrl;
    if (extraUrls) profile.extraUrls = extraUrls;
    if (healthUrl) profile.healthUrl = healthUrl;
    if (item.preferredOpenMode === "tab" || item.preferredOpenMode === "window") profile.preferredOpenMode = item.preferredOpenMode;
    if (notes) profile.notes = notes;
    if (logLines) profile.logLines = logLines.slice(-20);

    return [profile];
  });
};

export const scoreProfileForEntry = (entry: PortEntry, profile: ProjectProfile): number => {
  let score = 0;
  if (pathMatches(entry.projectHint, profile.projectPath) || pathMatches(entry.executablePath, profile.projectPath)) score += 100;
  if (profile.expectedPort === entry.port) score += 25;
  if (urlMatches(entry.url, profile.mainUrl)) score += 20;
  if (profile.extraUrls?.some((item) => urlMatches(entry.url, item.url))) score += 12;
  if (entry.title && entry.title.toLowerCase() === profile.name.toLowerCase()) score += 8;
  return score;
};

export const matchProfileForEntry = (entry: PortEntry, profiles: ProjectProfile[]): ProfileMatch | undefined =>
  profiles
    .map((profile) => ({ profile, score: scoreProfileForEntry(entry, profile) }))
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score || left.profile.name.localeCompare(right.profile.name))[0];

const profileHealthLabel = (entry: PortEntry | undefined): string => {
  if (!entry) return "No running port";
  if (entry.statusCode) return `Observed HTTP ${entry.statusCode}`;
  return "Port open";
};

const profileStatus = (profile: ProjectProfile, entry: PortEntry | undefined): ProfileState["status"] => {
  if (!entry) return "stopped";
  if (entry.statusCode && entry.statusCode >= 400) return "unhealthy";
  if (profile.healthUrl && !entry.statusCode) return "starting";
  return "running";
};

export const deriveProfileStates = (profiles: ProjectProfile[], entries: PortEntry[]): ProfileState[] =>
  profiles.map((profile) => {
    const entry = entries
      .map((candidate) => ({ entry: candidate, score: scoreProfileForEntry(candidate, profile) }))
      .filter((match) => match.score > 0)
      .sort((left, right) => right.score - left.score)[0]?.entry;
    return {
      profile,
      status: profileStatus(profile, entry),
      entry,
      healthLabel: profileHealthLabel(entry)
    };
  });
