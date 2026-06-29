import { describe, expect, it, vi } from "vitest";
import { createKillProcessTree, resolveKillTarget } from "../src/actions";

describe("resolveKillTarget", () => {
  it("refuses protected or mismatched targets before invoking platform kill", () => {
    expect(
      resolveKillTarget(
        { pid: 4, port: 135, mode: "force-tree" },
        [{ address: "0.0.0.0", port: 135, pid: 4 }],
        new Map([[4, { pid: 4, parentPid: 0, processName: "System", executablePath: "C:\\Windows\\System32\\ntoskrnl.exe" }]])
      )
    ).toMatchObject({
      allowed: false,
      message: "Refused to kill PID 4 on port 135: Protected system process."
    });

    expect(
      resolveKillTarget(
        { pid: 1234, port: 5173, mode: "force-tree" },
        [{ address: "127.0.0.1", port: 5173, pid: 9999 }],
        new Map([[1234, { pid: 1234, parentPid: 1, processName: "node.exe" }]])
      )
    ).toMatchObject({
      allowed: false,
      message: "Refused to kill PID 1234 because it is not the listener on port 5173."
    });
  });
});

describe("killProcessTree", () => {
  it("kills the matching listener and reports a closed port", async () => {
    const platformKillProcessTree = vi.fn().mockResolvedValue(undefined);
    const killProcessTree = createKillProcessTree({
      readTcpListeners: vi.fn().mockResolvedValue([{ address: "127.0.0.1", port: 5173, pid: 1234 }]),
      readProcessMetadata: vi.fn().mockResolvedValue(new Map([[1234, { pid: 1234, parentPid: 1, processName: "node" }]])),
      isPortListening: vi.fn().mockResolvedValue(false),
      platformKillProcessTree,
      portCloseTimeoutMs: 0
    });

    await expect(killProcessTree({ pid: 1234, port: 5173, mode: "force-tree" })).resolves.toMatchObject({
      killed: true,
      pid: 1234,
      port: 5173,
      portClosed: true
    });
    expect(platformKillProcessTree).toHaveBeenCalledWith({ pid: 1234, port: 5173, mode: "force-tree" });
  });

  it("reports a still-listening port after platform kill returns", async () => {
    const killProcessTree = createKillProcessTree({
      readTcpListeners: vi.fn().mockResolvedValue([{ address: "127.0.0.1", port: 5173, pid: 1234 }]),
      readProcessMetadata: vi.fn().mockResolvedValue(new Map([[1234, { pid: 1234, parentPid: 1, processName: "node" }]])),
      isPortListening: vi.fn().mockResolvedValue(true),
      platformKillProcessTree: vi.fn().mockResolvedValue(undefined),
      portCloseTimeoutMs: 0
    });

    await expect(killProcessTree({ pid: 1234, port: 5173, mode: "force-tree" })).resolves.toMatchObject({
      killed: true,
      pid: 1234,
      port: 5173,
      portClosed: false
    });
  });

  it("uses listener identity even when process metadata is unavailable", async () => {
    const platformKillProcessTree = vi.fn().mockResolvedValue(undefined);
    const killProcessTree = createKillProcessTree({
      readTcpListeners: vi.fn().mockResolvedValue([{ address: "127.0.0.1", port: 5173, pid: 1234 }]),
      readProcessMetadata: vi.fn().mockResolvedValue(new Map()),
      isPortListening: vi.fn().mockResolvedValue(false),
      platformKillProcessTree,
      portCloseTimeoutMs: 0
    });

    await expect(killProcessTree({ pid: 1234, port: 5173, mode: "force-tree" })).resolves.toMatchObject({
      killed: true,
      portClosed: true
    });
    expect(platformKillProcessTree).toHaveBeenCalledOnce();
  });

  it("treats metadata read errors as unavailable metadata", async () => {
    const platformKillProcessTree = vi.fn().mockResolvedValue(undefined);
    const killProcessTree = createKillProcessTree({
      readTcpListeners: vi.fn().mockResolvedValue([{ address: "127.0.0.1", port: 5173, pid: 1234 }]),
      readProcessMetadata: vi.fn().mockRejectedValue(new Error("ps output is not supported")),
      isPortListening: vi.fn().mockResolvedValue(false),
      platformKillProcessTree,
      portCloseTimeoutMs: 0
    });

    await expect(killProcessTree({ pid: 1234, port: 5173, mode: "force-tree" })).resolves.toMatchObject({
      killed: true,
      portClosed: true
    });
    expect(platformKillProcessTree).toHaveBeenCalledOnce();
  });
});
