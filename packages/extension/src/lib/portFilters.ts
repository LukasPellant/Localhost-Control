import type { DetectedKind, PortEntry } from "@localhost-control/shared";

export type FilterId = "all" | "web" | "node" | "python" | "unknown" | "protected";

const webKinds = new Set<DetectedKind>(["vite", "next", "convex", "static"]);

export const filterEntries = (entries: PortEntry[], options: { query: string; filter: FilterId }): PortEntry[] => {
  const query = options.query.trim().toLowerCase();

  return entries.filter((entry) => {
    const matchesFilter =
      options.filter === "all" ||
      (options.filter === "web" && webKinds.has(entry.detectedKind)) ||
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
    all: "All",
    web: "Web apps",
    node: "Node",
    python: "Python",
    unknown: "Unknown",
    protected: "Protected"
  };
  return labels[filter];
};
