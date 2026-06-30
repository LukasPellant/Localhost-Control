import type { ProjectProfile } from "./projectProfiles";
import { redactSensitiveText } from "./sensitiveText";

export type ProfileLogSeverity = "info" | "warning" | "error";

export type ProfileLogLine = {
  text: string;
  severity: ProfileLogSeverity;
};

const recentLogLimit = 4;
const copiedLogLimit = 20;

export const classifyProfileLogLine = (line: string): ProfileLogSeverity => {
  if (/\b(error|exception|failed|fatal)\b/i.test(line)) return "error";
  if (/\b(warn|warning|deprecated|deprecation)\b/i.test(line)) return "warning";
  return "info";
};

export const recentProfileLogLines = (profile: ProjectProfile | undefined, limit = recentLogLimit): ProfileLogLine[] =>
  (profile?.logLines ?? [])
    .slice(-limit)
    .map(redactSensitiveText)
    .filter(Boolean)
    .map((text) => ({ text, severity: classifyProfileLogLine(text) }));

export const formatProfileLogs = (profile: ProjectProfile, limit = copiedLogLimit): string => {
  const lines = recentProfileLogLines(profile, limit).map((line) => `- ${line.text}`);
  return [`Recent logs for ${profile.name}`, ...lines].join("\n");
};
