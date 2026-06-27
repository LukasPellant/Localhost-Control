import type { Classification, ClassifyInput, Confidence, DetectedKind, PortEntry } from "./types.js";

const SYSTEM_PROCESS_NAMES = new Set([
  "system",
  "registry",
  "idle",
  "smss.exe",
  "csrss.exe",
  "wininit.exe",
  "winlogon.exe",
  "services.exe",
  "lsass.exe",
  "svchost.exe",
  "spoolsv.exe",
  "fontdrvhost.exe",
  "wudfhost.exe"
]);

const BROWSER_PROCESS_NAMES = new Set(["chrome.exe", "brave.exe", "msedge.exe", "firefox.exe"]);

const kindFromText = (text: string, port: number): Classification => {
  if (/\bvite\b|vite\/|@vitejs/i.test(text) || port === 5173 || port === 5174) return { detectedKind: "vite", confidence: "high" };
  if (/\bnext\b|next-server|__next|x-nextjs/i.test(text) || port === 3000) return { detectedKind: "next", confidence: "high" };
  if (/\bconvex\b/i.test(text) || port === 3210) return { detectedKind: "convex", confidence: "high" };
  if (/\bpython(?:\.exe)?\b|uvicorn|flask|django|http\.server/i.test(text)) return { detectedKind: "python", confidence: "high" };
  if (/\bnode(?:\.exe)?\b|\bnpm\b|\bpnpm\b|\byarn\b|\bbun\b|\bdeno\b/i.test(text)) return { detectedKind: "node", confidence: "medium" };
  if (port >= 3000 && port <= 9999) return { detectedKind: "static", confidence: "low" };
  return { detectedKind: "unknown", confidence: "low" };
};

export const classifyPort = (input: ClassifyInput): Classification => {
  const haystack = [input.processName, input.commandLine, input.title, String(input.statusCode ?? "")].filter(Boolean).join(" ");
  return kindFromText(haystack, input.port);
};

export type ProtectionInput = Pick<PortEntry, "port" | "pid" | "processName" | "executablePath" | "detectedKind" | "confidence">;

export const protectPortEntry = <T extends ProtectionInput>(entry: T): T & { killable: boolean; protectionReason?: string } => {
  const processName = entry.processName.toLowerCase();
  const executablePath = entry.executablePath?.toLowerCase() ?? "";

  let protectionReason: string | undefined;
  if (entry.pid <= 4) {
    protectionReason = "Protected system process";
  } else if (entry.port < 1024) {
    protectionReason = "Protected low system port";
  } else if (SYSTEM_PROCESS_NAMES.has(processName)) {
    protectionReason = "Protected Windows service process";
  } else if (BROWSER_PROCESS_NAMES.has(processName)) {
    protectionReason = "Protected browser process";
  } else if (executablePath.startsWith("c:\\windows\\")) {
    protectionReason = "Protected Windows executable";
  }

  return protectionReason
    ? { ...entry, killable: false, protectionReason }
    : { ...entry, killable: true };
};

export const kindLabel = (kind: DetectedKind): string => {
  const labels: Record<DetectedKind, string> = {
    vite: "Vite",
    next: "Next",
    convex: "Convex",
    python: "Python",
    node: "Node",
    static: "Static",
    unknown: "Unknown"
  };
  return labels[kind];
};

export const confidenceWeight = (confidence: Confidence): number => {
  if (confidence === "high") return 3;
  if (confidence === "medium") return 2;
  return 1;
};
