import { spawn } from "node:child_process";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { killProcessTree, resolveKillTarget } from "../src/actions";

let childPid: number | undefined;

const getFreePort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address) resolve(address.port);
        else reject(new Error("No address returned"));
      });
    });
  });

const waitForHttp = async (port: number): Promise<void> => {
  const deadline = Date.now() + 5000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}`);
      await response.text();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Server did not start");
};

afterEach(() => {
  if (childPid) {
    try {
      process.kill(childPid, "SIGKILL");
    } catch {
      // The test normally kills the process through taskkill first.
    }
    childPid = undefined;
  }
});

describe("killProcessTree", () => {
  it("refuses protected or mismatched targets before invoking taskkill", () => {
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

  it("force-kills a disposable localhost server and reports the port closed", async () => {
    const port = await getFreePort();
    const child = spawn(process.execPath, [
      "-e",
      `require('node:http').createServer((_, res) => res.end('ok')).listen(${port}, '127.0.0.1')`
    ], {
      stdio: "ignore",
      windowsHide: true
    });
    childPid = child.pid;
    expect(childPid).toBeTypeOf("number");

    await waitForHttp(port);

    const result = await killProcessTree({ pid: childPid!, port, mode: "force-tree" });

    expect(result).toMatchObject({ killed: true, pid: childPid, port, portClosed: true });
    childPid = undefined;
  }, 10_000);
});
