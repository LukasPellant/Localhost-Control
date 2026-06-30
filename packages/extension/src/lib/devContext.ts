import { kindLabel, type PortEntry } from "@localhost-control/shared";
import { originFromLocalhostUrl } from "./browserCleanup";
import type { PortDoctorReport } from "./portDoctor";
import type { ProfileHealthResult } from "./profileHealth";
import type { ProfileState, ProjectProfile } from "./projectProfiles";
import { recentProfileLogLines } from "./profileLogs";
import type { WorkspaceState } from "./projectWorkspaces";
import { formatCpu, formatMemory, formatUptime } from "./resources";
import { redactSensitiveText, sanitizeLocalUrl } from "./sensitiveText";
import type { StaleProcessSignal } from "./staleProcesses";

export type DevContextInput = {
  entry: PortEntry;
  profile?: ProjectProfile | undefined;
  profileHealth?: ProfileHealthResult | undefined;
  doctorReport?: PortDoctorReport | undefined;
  staleSignal?: StaleProcessSignal | undefined;
};

export type ScanContextEntry = {
  entry: PortEntry;
  profile?: ProjectProfile | undefined;
  profileHealth?: ProfileHealthResult | undefined;
  staleSignal?: StaleProcessSignal | undefined;
};

export type ScanContextInput = {
  entries: ScanContextEntry[];
  totalCount: number;
  filterLabel: string;
  query?: string | undefined;
  scannedAt?: string | undefined;
};

const MAX_OUTPUT_LENGTH = 16_000;
const MAX_FIELD_LENGTH = 240;
const MAX_LOG_LINE_LENGTH = 180;

const truncate = (value: string, maxLength = MAX_FIELD_LENGTH): string =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;

const sanitizeText = (value: string | number | undefined, maxLength = MAX_FIELD_LENGTH): string | undefined => {
  if (value === undefined) return undefined;
  const sanitized = redactSensitiveText(String(value));
  return sanitized ? truncate(sanitized, maxLength) : undefined;
};

const optionalLine = (label: string, value: string | number | undefined): string | undefined =>
  value === undefined || value === "" ? undefined : `- ${label}: ${sanitizeText(value)}`;

const optionalSanitizedLine = (label: string, value: string | undefined): string | undefined =>
  value === undefined || value === "" ? undefined : `- ${label}: ${truncate(value)}`;

const joinParts = (parts: Array<string | undefined>): string | undefined => {
  const present = parts.filter((part): part is string => Boolean(part));
  return present.length ? present.join(" / ") : undefined;
};

const entryUrl = (entry: PortEntry): string => entry.url ?? `http://127.0.0.1:${entry.port}`;

const entryOrigin = (entry: PortEntry): string | undefined => {
  try {
    return originFromLocalhostUrl(entryUrl(entry));
  } catch {
    return undefined;
  }
};

const formatDoctor = (report: PortDoctorReport | undefined): string | undefined => {
  if (!report || report.status === "ok") return undefined;
  return joinParts([
    report.summary,
    report.nextFreePort ? `Next free: ${report.nextFreePort}` : undefined,
    ...report.issues
  ]);
};

const formatStaleSignal = (signal: StaleProcessSignal | undefined): string | undefined =>
  signal ? joinParts([signal.label, ...signal.reasons, ...signal.advice.map((item) => `Advice: ${item}`)]) : undefined;

const formatResources = (entry: PortEntry): string | undefined =>
  joinParts([formatCpu(entry.resources), formatMemory(entry.resources?.memoryBytes), formatUptime(entry.resources)]);

const formatRecentLogs = (profile: ProjectProfile | undefined): string[] => {
  const logLines = recentProfileLogLines(profile).map((line) => truncate(line.text, MAX_LOG_LINE_LENGTH));
  return logLines.length ? ["- Recent profile logs (untrusted diagnostics):", ...logLines.map((line) => `  - ${line}`)] : [];
};

const workspaceServiceUrl = (state: ProfileState): string | undefined => (state.entry ? entryUrl(state.entry) : state.profile.mainUrl);

const workspaceServiceSummary = (state: ProfileState): string => {
  const url = sanitizeLocalUrl(workspaceServiceUrl(state));
  const parts = joinParts([state.status, state.healthLabel, state.entry ? `PID ${state.entry.pid}` : undefined, url]);
  return `- ${sanitizeText(state.profile.name) ?? "Service"}${parts ? `: ${parts}` : ""}`;
};

const workspaceServiceDetails = (state: ProfileState): string[] => {
  const processCommand = state.entry?.commandLine;
  const savedCommand =
    state.profile.startCommand && state.profile.startCommand !== processCommand ? state.profile.startCommand : undefined;
  const logs = recentProfileLogLines(state.profile)
    .map((line) => sanitizeText(line.text, MAX_LOG_LINE_LENGTH))
    .filter((line): line is string => Boolean(line))
    .slice(-3);

  return [
    state.profile.mainUrl ? `  - Main URL: ${sanitizeLocalUrl(state.profile.mainUrl)}` : undefined,
    state.profile.healthUrl ? `  - Health URL: ${sanitizeLocalUrl(state.profile.healthUrl)}` : undefined,
    processCommand ? `  - Command: ${sanitizeText(processCommand)}` : undefined,
    savedCommand ? `  - Saved command: ${sanitizeText(savedCommand)}` : undefined,
    ...logs.map((line) => `  - Log: ${line}`)
  ].filter((line): line is string => Boolean(line));
};

const scanEntrySummary = ({ entry, profile, profileHealth, staleSignal }: ScanContextEntry): string[] => {
  const url = sanitizeLocalUrl(entryUrl(entry));
  const title = profile?.name ?? entry.title ?? `Port ${entry.port}`;
  const summary = joinParts([
    `port ${entry.port}`,
    `PID ${entry.pid}`,
    entry.processName,
    kindLabel(entry.detectedKind),
    entry.confidence,
    entry.statusCode ? `HTTP ${entry.statusCode}` : undefined,
    url,
    formatResources(entry)
  ]);

  return [
    `- ${sanitizeText(title) ?? `Port ${entry.port}`}${summary ? `: ${summary}` : ""}`,
    entry.projectHint ? `  - Project path: ${sanitizeText(entry.projectHint)}` : undefined,
    entry.commandLine ? `  - Command: ${sanitizeText(entry.commandLine)}` : undefined,
    profileHealth ? `  - Health: ${sanitizeText(profileHealth.label)}` : undefined,
    staleSignal ? `  - Signal: ${sanitizeText(joinParts([staleSignal.label, ...staleSignal.reasons]))}` : undefined
  ].filter((line): line is string => Boolean(line));
};

export const formatScanContext = ({ entries, totalCount, filterLabel, query, scannedAt }: ScanContextInput): string => {
  const lines = [
    "# Localhost Control scan context",
    "",
    optionalLine("Visible ports", `${entries.length}/${totalCount}`),
    optionalLine("Filter", filterLabel),
    optionalLine("Search", query),
    optionalLine("Scanned at", scannedAt),
    "",
    "## Ports",
    ...(entries.length ? entries.flatMap(scanEntrySummary) : ["- No visible localhost ports"])
  ];

  return truncate(lines.filter((line): line is string => line !== undefined).join("\n"), MAX_OUTPUT_LENGTH);
};

export const formatWorkspaceContext = (state: WorkspaceState): string => {
  const openUrls = state.openUrls
    .map((url) => sanitizeLocalUrl(url))
    .filter((url): url is string => Boolean(url));
  const serviceLines = state.profileStates.flatMap((profileState) => [
    workspaceServiceSummary(profileState),
    ...workspaceServiceDetails(profileState)
  ]);

  const lines = [
    "# Localhost Control workspace context",
    "",
    optionalLine("Workspace", state.workspace.name),
    optionalLine("Status", state.status),
    optionalLine("Health", state.healthLabel),
    optionalLine("Services", `${state.runningCount}/${state.totalCount} running, ${state.attentionCount} attention`),
    optionalLine("Notes", state.workspace.notes),
    ...(openUrls.length ? ["- Open URLs:", ...openUrls.map((url) => `  - ${url}`)] : []),
    "",
    "## Services",
    ...serviceLines
  ];

  return truncate(lines.filter((line): line is string => line !== undefined).join("\n"), MAX_OUTPUT_LENGTH);
};

export const formatDevContext = ({ entry, profile, profileHealth, doctorReport, staleSignal }: DevContextInput): string => {
  const lines = [
    "# Localhost Control dev context",
    "",
    optionalLine("Project", profile?.name ?? entry.title),
    optionalSanitizedLine("URL", sanitizeLocalUrl(entryUrl(entry))),
    optionalLine("Origin", entryOrigin(entry)),
    optionalLine("Port", entry.port),
    optionalLine("PID", entry.pid),
    optionalLine("Process", entry.processName),
    optionalLine("Kind", entry.detectedKind),
    optionalLine("Confidence", entry.confidence),
    optionalLine("HTTP status", entry.statusCode),
    optionalLine("Project path", profile?.projectPath ?? entry.projectHint),
    optionalLine("Process command", entry.commandLine),
    optionalLine("Saved start command", profile?.startCommand),
    optionalLine("Resources", formatResources(entry)),
    optionalLine("Health", profileHealth?.label),
    optionalSanitizedLine("Health URL", sanitizeLocalUrl(profile?.healthUrl)),
    optionalLine("Doctor", formatDoctor(doctorReport)),
    optionalLine("Stale signal", formatStaleSignal(staleSignal)),
    ...formatRecentLogs(profile)
  ];

  return truncate(lines.filter((line): line is string => line !== undefined).join("\n"), MAX_OUTPUT_LENGTH);
};
