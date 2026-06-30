import type { PortEntry } from "@localhost-control/shared";
import type { ProjectProfile } from "./projectProfiles";

export type StaleProcessSignal = {
  severity: "medium" | "high";
  label: "Possible stale process" | "Possible ghost process";
  reasons: string[];
  advice: string[];
};

const longUptimeMs = 2 * 60 * 60 * 1000;
const veryLongUptimeMs = 6 * 60 * 60 * 1000;
const highMemoryBytes = 750 * 1024 * 1024;

export const detectStaleProcess = (entry: PortEntry, profile: ProjectProfile | undefined): StaleProcessSignal | undefined => {
  if (!entry.killable) return undefined;

  const reasons: string[] = [];
  let score = 0;
  let hasRuntimeEvidence = false;
  let hasLongUptime = false;

  const uptimeMs = entry.resources?.uptimeMs ?? 0;
  if (uptimeMs >= veryLongUptimeMs) {
    reasons.push("Long uptime");
    score += 3;
    hasRuntimeEvidence = true;
    hasLongUptime = true;
  } else if (uptimeMs >= longUptimeMs) {
    reasons.push("Long uptime");
    score += 2;
    hasRuntimeEvidence = true;
    hasLongUptime = true;
  }

  if ((entry.resources?.memoryBytes ?? 0) >= highMemoryBytes) {
    reasons.push("High memory");
    score += 2;
    hasRuntimeEvidence = true;
  }

  if (!profile) {
    reasons.push("No project profile");
    score += entry.projectHint ? 1 : 2;
  }

  if (entry.confidence === "low" || entry.detectedKind === "unknown") {
    reasons.push("Low confidence");
    score += 2;
  }

  if (entry.statusCode && entry.statusCode >= 500) {
    reasons.push(`HTTP ${entry.statusCode}`);
    score += 1;
  }

  if (!hasRuntimeEvidence || score < 4) return undefined;

  const isGhostCandidate =
    !profile &&
    !entry.projectHint &&
    hasLongUptime &&
    (entry.confidence === "low" || entry.detectedKind === "unknown") &&
    score >= 6;

  const label = isGhostCandidate ? "Possible ghost process" : "Possible stale process";
  const advice = [
    "If this listener is unexpected, review and stop it safely, then refresh the scan.",
    profile || entry.projectHint ? undefined : "Save a profile or trust the project if this listener is expected.",
    entry.detectedKind === "unknown" || entry.confidence === "low" ? "Hide this process name if it is a known local background service." : undefined
  ].filter((item): item is string => Boolean(item));

  return {
    severity: score >= 6 ? "high" : "medium",
    label,
    reasons,
    advice
  };
};

export const formatStaleProcessAdvice = (entry: PortEntry, signal: StaleProcessSignal): string =>
  [
    `${signal.label} on port ${entry.port} (PID ${entry.pid}, ${entry.processName})`,
    `Reasons: ${signal.reasons.join(", ")}`,
    ...signal.advice
  ].join("\n");
