import type { DetectedKind, PortEntry } from "@localhost-control/shared";

export type FilterId = "web" | "custom" | "all" | "node" | "python" | "unknown" | "protected";

const webKinds = new Set<DetectedKind>(["vite", "next", "convex"]);
const trustedStaticProcesses = new Set(["node.exe", "python.exe", "python3.exe", "bun.exe", "deno.exe"]);

const parsePortRanges = (value: string): Array<{ min: number; max: number }> =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const match = part.match(/^(\d{1,5})(?:\s*-\s*(\d{1,5}))?$/);
      if (!match) return [];
      const first = Number(match[1]);
      const second = match[2] ? Number(match[2]) : first;
      const min = Math.min(first, second);
      const max = Math.max(first, second);
      if (min < 1 || max > 65535) return [];
      return [{ min, max }];
    });

const isTrustedStaticWebApp = (entry: PortEntry): boolean =>
  entry.detectedKind === "static" &&
  trustedStaticProcesses.has(entry.processName.toLowerCase()) &&
  Boolean(entry.projectHint || entry.commandLine?.toLowerCase().includes("http.server"));

const isTrustedDevServerProcess = (entry: PortEntry): boolean =>
  ["node", "python"].includes(entry.detectedKind) &&
  trustedStaticProcesses.has(entry.processName.toLowerCase()) &&
  Boolean(entry.projectHint || entry.commandLine);

const isWebAppEntry = (entry: PortEntry): boolean =>
  webKinds.has(entry.detectedKind) || isTrustedStaticWebApp(entry) || isTrustedDevServerProcess(entry);

const isInCustomRange = (entry: PortEntry, customPortRange: string): boolean => {
  const ranges = parsePortRanges(customPortRange);
  if (!ranges.length) return false;
  return ranges.some((range) => entry.port >= range.min && entry.port <= range.max);
};

export const filterEntries = (entries: PortEntry[], options: { query: string; filter: FilterId; customPortRange?: string }): PortEntry[] => {
  const query = options.query.trim().toLowerCase();

  return entries.filter((entry) => {
    const matchesFilter =
      options.filter === "all" ||
      (options.filter === "web" && isWebAppEntry(entry)) ||
      (options.filter === "custom" && isInCustomRange(entry, options.customPortRange ?? "")) ||
      (options.filter === "node" && entry.detectedKind === "node") ||
      (options.filter === "python" && entry.detectedKind === "python") ||
      (options.filter === "unknown" && entry.detectedKind === "unknown" && entry.killable) ||
      (options.filter === "protected" && !entry.killable);

    if (!matchesFilter) return false;
    if (!query) return true;

    return [
      entry.port,
      entry.address,
      entry.pid,
      entry.processName,
      entry.detectedKind,
      entry.title,
      entry.projectHint,
      entry.commandLine,
      entry.protectionReason
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
};

export const filterLabel = (filter: FilterId): string => {
  const labels: Record<FilterId, string> = {
    web: "Web apps",
    custom: "Custom",
    all: "All",
    node: "Node",
    python: "Python",
    unknown: "Unknown",
    protected: "Protected"
  };
  return labels[filter];
};
