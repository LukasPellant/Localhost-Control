import { describe, expect, it } from "vitest";
import {
  HOST_NAME,
  isHostRequest,
  isKillResult,
  isScanResult,
  type HostRequest
} from "../src/index";

describe("native messaging protocol", () => {
  it("accepts the stable host name used by the extension and installer", () => {
    expect(HOST_NAME).toBe("com.localhost_control.host");
  });

  it("validates scan requests without accepting malformed params", () => {
    const request: HostRequest = {
      id: "scan-1",
      method: "scan",
      params: { includeSystemPorts: false, httpProbe: true, maxProbeMs: 500 }
    };

    expect(isHostRequest(request)).toBe(true);
    expect(isHostRequest({ id: "scan-1", method: "scan", params: { httpProbe: true } })).toBe(false);
  });

  it("validates kill results and scan results", () => {
    expect(
      isKillResult({ killed: true, pid: 1234, port: 5173, portClosed: true, message: "Killed" })
    ).toBe(true);
    expect(isKillResult({ killed: true, portClosed: true })).toBe(false);
    expect(
      isScanResult({
        entries: [
          {
            port: 5173,
            address: "127.0.0.1",
            pid: 1234,
            processName: "node.exe",
            detectedKind: "vite",
            confidence: "high",
            killable: true,
            resources: {
              cpuPercent: 8.5,
              memoryBytes: 268_435_456,
              privateMemoryBytes: 134_217_728,
              threadCount: 18,
              handleCount: 210,
              uptimeMs: 120_000
            }
          }
        ],
        scannedAt: "2026-06-27T10:00:00.000Z",
        durationMs: 28
      })
    ).toBe(true);
    expect(isScanResult({ entries: "nope" })).toBe(false);
    expect(
      isScanResult({
        entries: [
          {
            port: 5173,
            address: "127.0.0.1",
            pid: 1234,
            processName: "node.exe",
            detectedKind: "vite",
            confidence: "high",
            killable: true,
            resources: { cpuPercent: "busy" }
          }
        ],
        scannedAt: "2026-06-27T10:00:00.000Z",
        durationMs: 28
      })
    ).toBe(false);
  });
});
