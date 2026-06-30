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

  it("validates terminal requests with explicit command execution intent", () => {
    expect(
      isHostRequest({
        id: "terminal-1",
        method: "openTerminal",
        params: { projectHint: "D:\\Projects\\ExampleShop", commandLine: "pnpm dev", executeCommand: true }
      })
    ).toBe(true);
    expect(
      isHostRequest({
        id: "terminal-1",
        method: "openTerminal",
        params: { projectHint: "D:\\Projects\\ExampleShop", commandLine: "pnpm dev", executeCommand: "yes" }
      })
    ).toBe(false);
  });

  it("validates project folder open requests", () => {
    expect(
      isHostRequest({
        id: "folder-1",
        method: "openProjectFolder",
        params: { projectPath: "D:\\Projects\\ExampleShop" }
      })
    ).toBe(true);
    expect(
      isHostRequest({
        id: "folder-1",
        method: "openProjectFolder",
        params: { projectPath: "" }
      })
    ).toBe(false);
    expect(
      isHostRequest({
        id: "folder-1",
        method: "openProjectFolder",
        params: { projectPath: 123 }
      })
    ).toBe(false);
  });

  it("validates kill results and scan results", () => {
    const validEntry = {
      port: 5173,
      address: "127.0.0.1",
      pid: 1234,
      processName: "node.exe",
      detectedKind: "vite",
      confidence: "high",
      killable: true
    };

    expect(isHostRequest({ id: "kill-1", method: "kill", params: { pid: 1234, port: 5173, mode: "force-tree" } })).toBe(true);
    expect(isHostRequest({ id: "kill-1", method: "kill", params: { pid: 1234, port: 5173, mode: "terminate-tree" } })).toBe(true);
    expect(isHostRequest({ id: "kill-1", method: "kill", params: { pid: 1234.5, port: 5173, mode: "force-tree" } })).toBe(false);
    expect(isHostRequest({ id: "kill-1", method: "kill", params: { pid: 1234, port: 70000, mode: "force-tree" } })).toBe(false);
    expect(isHostRequest({ id: "kill-1", method: "kill", params: { pid: 1234, port: 5173, mode: "ask-politely" } })).toBe(false);

    expect(
      isKillResult({ killed: true, pid: 1234, port: 5173, portClosed: true, message: "Killed" })
    ).toBe(true);
    expect(isKillResult({ killed: true, portClosed: true })).toBe(false);
    expect(isKillResult({ killed: true, pid: -1, port: 5173, portClosed: true, message: "Killed" })).toBe(false);
    expect(isKillResult({ killed: true, pid: 1234.5, port: 5173, portClosed: true, message: "Killed" })).toBe(false);
    expect(isKillResult({ killed: true, pid: 1234, port: 70000, portClosed: true, message: "Killed" })).toBe(false);
    expect(
      isScanResult({
        entries: [
          {
            ...validEntry,
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
        entries: [{ ...validEntry, resources: { cpuPercent: "busy" } }],
        scannedAt: "2026-06-27T10:00:00.000Z",
        durationMs: 28
      })
    ).toBe(false);
    expect(
      isScanResult({
        entries: [{ ...validEntry, detectedKind: "definitely-not-a-kind" }],
        scannedAt: "2026-06-27T10:00:00.000Z",
        durationMs: 28
      })
    ).toBe(false);
    expect(
      isScanResult({
        entries: [{ ...validEntry, confidence: "maybe" }],
        scannedAt: "2026-06-27T10:00:00.000Z",
        durationMs: 28
      })
    ).toBe(false);
    expect(
      isScanResult({
        entries: [{ ...validEntry, port: 70000 }],
        scannedAt: "2026-06-27T10:00:00.000Z",
        durationMs: 28
      })
    ).toBe(false);
    expect(
      isScanResult({
        entries: [{ ...validEntry, projectHint: 123 }],
        scannedAt: "2026-06-27T10:00:00.000Z",
        durationMs: 28
      })
    ).toBe(false);
    expect(
      isScanResult({
        entries: [{ ...validEntry, url: 123 }],
        scannedAt: "2026-06-27T10:00:00.000Z",
        durationMs: 28
      })
    ).toBe(false);
    expect(
      isScanResult({
        entries: [{ ...validEntry, statusCode: "200" }],
        scannedAt: "2026-06-27T10:00:00.000Z",
        durationMs: 28
      })
    ).toBe(false);
    expect(
      isScanResult({
        entries: [{ ...validEntry, parentPid: 0 }],
        scannedAt: "2026-06-27T10:00:00.000Z",
        durationMs: 28
      })
    ).toBe(false);
  });
});
