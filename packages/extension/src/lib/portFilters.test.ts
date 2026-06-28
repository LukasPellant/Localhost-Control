import { describe, expect, it } from "vitest";
import { filterEntries } from "./portFilters";
import type { PortEntry } from "@localhost-control/shared";

const entries: PortEntry[] = [
  { port: 5173, address: "127.0.0.1", pid: 10, processName: "node.exe", detectedKind: "vite", confidence: "high", killable: true },
  {
    port: 17321,
    address: "127.0.0.1",
    pid: 12,
    processName: "node.exe",
    detectedKind: "node",
    confidence: "medium",
    killable: true,
    projectHint: "C:\\Users\\pella\\Documents\\ChatGPT-codex-bridge"
  },
  {
    port: 6463,
    address: "127.0.0.1",
    pid: 13,
    processName: "Discord.exe",
    detectedKind: "node",
    confidence: "medium",
    killable: true,
    projectHint: "C:\\Users\\pella\\AppData\\Local\\Discord"
  },
  { port: 8000, address: "127.0.0.1", pid: 11, processName: "python.exe", detectedKind: "python", confidence: "high", killable: true },
  { port: 135, address: "0.0.0.0", pid: 4, processName: "System", detectedKind: "unknown", confidence: "low", killable: false, protectionReason: "Protected system process" }
];

describe("filterEntries", () => {
  it("filters by kind and search text while keeping protected entries explicit", () => {
    expect(filterEntries(entries, { query: "5173", filter: "web" }).map((entry) => entry.port)).toEqual([5173]);
    expect(filterEntries(entries, { query: "python", filter: "python" }).map((entry) => entry.port)).toEqual([8000]);
    expect(filterEntries(entries, { query: "", filter: "protected" }).map((entry) => entry.port)).toEqual([135]);
  });

  it("keeps trusted dev servers in Web apps while excluding app-owned node listeners", () => {
    expect(filterEntries(entries, { query: "", filter: "web" }).map((entry) => entry.port)).toEqual([5173, 17321]);
  });
});
