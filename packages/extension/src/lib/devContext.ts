import type { PortEntry } from "@localhost-control/shared";
import { originFromLocalhostUrl } from "./browserCleanup";
import type { PortDoctorReport } from "./portDoctor";
import type { ProfileHealthResult } from "./profileHealth";
import type { ProjectProfile } from "./projectProfiles";
import { formatCpu, formatMemory, formatUptime } from "./resources";
import type { StaleProcessSignal } from "./staleProcesses";

export type DevContextInput = {
  entry: PortEntry;
  profile?: ProjectProfile | undefined;
  profileHealth?: ProfileHealthResult | undefined;
  doctorReport?: PortDoctorReport | undefined;
  staleSignal?: StaleProcessSignal | undefined;
};

const MAX_OUTPUT_LENGTH = 16_000;
const MAX_FIELD_LENGTH = 240;
const MAX_LOG_LINES = 4;
const MAX_LOG_LINE_LENGTH = 180;
const SECRET_VALUE_PATTERN = /(OPENAI_API_KEY|ANTHROPIC_API_KEY|GITHUB_TOKEN|DATABASE_URL|PASSWORD|SECRET|TOKEN|API_KEY)=("[^"]*"|'[^']*'|\S+)/gi;
const SECRET_FLAG_PATTERN = /(--(?:token|api-key|password|secret)\s+)("[^"]*"|'[^']*'|\S+)/gi;
const AUTH_HEADER_PATTERN = /(Authorization:\s*Bearer\s+)\S+/gi;
const SECRET_QUERY_KEYS = /^(access_token|api_key|apikey|auth|code|key|password|secret|token)$/i;

const stripControlCharacters = (value: string): string =>
  value
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();

const redactSecrets = (value: string): string =>
  stripControlCharacters(value)
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/g, (match) => `${match.slice(0, 9)}[user]`)
    .replace(/\/Users\/[^/\s]+/g, "/Users/[user]")
    .replace(/\/home\/[^/\s]+/g, "/home/[user]")
    .replace(SECRET_VALUE_PATTERN, "$1=[redacted]")
    .replace(SECRET_FLAG_PATTERN, "$1[redacted]")
    .replace(AUTH_HEADER_PATTERN, "$1[redacted]");

const truncate = (value: string, maxLength = MAX_FIELD_LENGTH): string =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;

const sanitizeText = (value: string | number | undefined, maxLength = MAX_FIELD_LENGTH): string | undefined => {
  if (value === undefined) return undefined;
  const sanitized = redactSecrets(String(value));
  return sanitized ? truncate(sanitized, maxLength) : undefined;
};

const sanitizeLocalUrl = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    url.hash = "";
    url.searchParams.forEach((_paramValue, key) => {
      if (SECRET_QUERY_KEYS.test(key)) {
        url.searchParams.set(key, "redacted");
      }
    });
    return sanitizeText(url.toString().replace(/\/$/, ""));
  } catch {
    return sanitizeText(value);
  }
};

const optionalLine = (label: string, value: string | number | undefined): string | undefined =>
  value === undefined || value === "" ? undefined : `- ${label}: ${sanitizeText(value)}`;

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
  signal ? joinParts([signal.label, ...signal.reasons]) : undefined;

const formatResources = (entry: PortEntry): string | undefined =>
  joinParts([formatCpu(entry.resources), formatMemory(entry.resources?.memoryBytes), formatUptime(entry.resources)]);

const formatRecentLogs = (profile: ProjectProfile | undefined): string[] => {
  const logLines = profile?.logLines
    ?.slice(-MAX_LOG_LINES)
    .map((line) => sanitizeText(line, MAX_LOG_LINE_LENGTH))
    .filter((line): line is string => Boolean(line));
  if (!logLines?.length) return [];
  return ["- Recent profile logs (untrusted diagnostics):", ...logLines.map((line) => `  - ${line}`)];
};

export const formatDevContext = ({ entry, profile, profileHealth, doctorReport, staleSignal }: DevContextInput): string => {
  const lines = [
    "# Localhost Control dev context",
    "",
    optionalLine("Project", profile?.name ?? entry.title),
    optionalLine("URL", sanitizeLocalUrl(entryUrl(entry))),
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
    optionalLine("Health URL", sanitizeLocalUrl(profile?.healthUrl)),
    optionalLine("Doctor", formatDoctor(doctorReport)),
    optionalLine("Stale signal", formatStaleSignal(staleSignal)),
    ...formatRecentLogs(profile)
  ];

  return truncate(lines.filter((line): line is string => line !== undefined).join("\n"), MAX_OUTPUT_LENGTH);
};
