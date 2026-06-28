import type { AppScope, Classification, ClassifyInput, Confidence, DetectedKind, PortEntry, ScopePolicy } from "./types.js";

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
const DEV_APP_KINDS = new Set<DetectedKind>(["vite", "next", "convex", "python", "node", "static"]);
const DEV_SERVER_PROCESS_NAMES = new Set(["node.exe", "python.exe", "python3.exe", "bun.exe", "deno.exe"]);

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

const normalizePath = (value: string): string =>
  value
    .trim()
    .replace(/\//g, "\\")
    .replace(/\\+$/, "")
    .toLowerCase();

const isPathInside = (candidate: string, root: string): boolean => {
  const normalizedCandidate = normalizePath(candidate);
  const normalizedRoot = normalizePath(root);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}\\`);
};

const hasTrustedPath = (entry: PortEntry, policy: ScopePolicy): boolean => {
  const candidate = entry.projectHint ?? entry.executablePath ?? entry.commandLine ?? "";
  if (!candidate.trim()) return false;
  const paths = [...policy.trustedProjectRoots, ...policy.trustedProjectPaths].filter(Boolean);
  return paths.some((path) => isPathInside(candidate, path));
};

export const scopePortEntry = (entry: PortEntry, policy: ScopePolicy): AppScope => {
  if (!entry.killable || entry.protectionReason) return "protected";

  const processName = entry.processName.toLowerCase();
  if (policy.blockedProcessNames.map((name) => name.toLowerCase()).includes(processName)) {
    return "local-service";
  }

  const trustedPath = hasTrustedPath(entry, policy);
  const trustedProcess = DEV_SERVER_PROCESS_NAMES.has(processName);
  const devKind = DEV_APP_KINDS.has(entry.detectedKind);
  const staticDevServer =
    entry.detectedKind !== "static" || trustedProcess || Boolean(entry.commandLine?.toLowerCase().includes("http.server"));

  return trustedPath && devKind && staticDevServer ? "dev-app" : "local-service";
};

export const withAppScope = <T extends PortEntry>(entry: T, policy: ScopePolicy): T & { appScope: AppScope } => ({
  ...entry,
  appScope: scopePortEntry(entry, policy)
});

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
