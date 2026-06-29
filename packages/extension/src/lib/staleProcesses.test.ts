import { describe, expect, it } from "vitest";
import type { PortEntry } from "@localhost-control/shared";
import { detectStaleProcess } from "./staleProcesses";

const baseEntry: PortEntry = {
  port: 8990,
  address: "127.0.0.1",
  pid: 900,
  processName: "preview-service.exe",
  detectedKind: "unknown",
  confidence: "low",
  killable: true,
  resources: {
    cpuPercent: 0.2,
    memoryBytes: 950_000_000,
    uptimeMs: 8 * 60 * 60 * 1000
  }
};

describe("stale process detection", () => {
  it("marks long-running heavy unknown listeners as stale candidates", () => {
    const signal = detectStaleProcess(baseEntry, undefined);

    expect(signal).toEqual({
      severity: "high",
      label: "Possible stale process",
      reasons: ["Long uptime", "High memory", "No project profile", "Low confidence"]
    });
  });

  it("does not flag a healthy matched dev profile", () => {
    const signal = detectStaleProcess(
      {
        ...baseEntry,
        detectedKind: "vite",
        confidence: "high",
        statusCode: 200,
        resources: { uptimeMs: 10 * 60 * 1000, memoryBytes: 160_000_000 }
      },
      { id: "shop", name: "Example Shop" }
    );

    expect(signal).toBeUndefined();
  });

  it("does not flag unknown listeners without stale runtime evidence", () => {
    const { resources: _resources, ...entryWithoutResources } = baseEntry;
    const signal = detectStaleProcess(
      entryWithoutResources,
      undefined
    );

    expect(signal).toBeUndefined();
  });
});
