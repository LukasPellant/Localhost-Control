import { describe, expect, it, vi } from "vitest";
import { createUnixKillProcessTree, isNoChildProcessResult } from "../src/platform/unixProcessTree";

describe("createUnixKillProcessTree", () => {
  it("kills descendants before the target PID without signaling a process group", async () => {
    const sendSignal = vi.fn().mockResolvedValue(undefined);
    const readChildren = vi.fn(async (pid: number) => {
      if (pid === 100) return [101, 102];
      if (pid === 101) return [103];
      return [];
    });
    const killProcessTree = createUnixKillProcessTree({ readChildren, sendSignal, sleep: vi.fn() });

    await killProcessTree({ pid: 100, port: 5173, mode: "force-tree" });

    expect(sendSignal).toHaveBeenCalledWith(103, "TERM");
    expect(sendSignal).toHaveBeenCalledWith(101, "TERM");
    expect(sendSignal).toHaveBeenCalledWith(102, "TERM");
    expect(sendSignal).toHaveBeenCalledWith(100, "TERM");
    expect(sendSignal).toHaveBeenCalledWith(103, "KILL");
    expect(sendSignal).toHaveBeenCalledWith(101, "KILL");
    expect(sendSignal).toHaveBeenCalledWith(102, "KILL");
    expect(sendSignal).toHaveBeenCalledWith(100, "KILL");
    expect(sendSignal.mock.calls.every(([pid]) => pid > 0)).toBe(true);
  });

  it("recognizes pgrep exit code 1 as an empty child list", () => {
    expect(isNoChildProcessResult({ code: 1, stdout: "", stderr: "" })).toBe(true);
  });
});
