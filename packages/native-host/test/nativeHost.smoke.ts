import { spawn } from "node:child_process";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { killProcessTree } from "../src/actions";
import { readProcessMetadata } from "../src/processMetadata";

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
      // The smoke test normally kills the process through the native host action.
    }
    childPid = undefined;
  }
});

describe("readProcessMetadata smoke", () => {
  it("reports current process metadata when the host OS supports it", async () => {
    const metadata = await readProcessMetadata([process.pid]);
    const current = metadata.get(process.pid);
    console.info(
      "readProcessMetadata smoke",
      JSON.stringify(
        {
          platform: process.platform,
          pid: process.pid,
          metadataSize: metadata.size,
          currentProcessFound: Boolean(current),
          resourceKeys: Object.keys(current?.resources ?? {})
        },
        null,
        2
      )
    );

    expect(metadata).toBeInstanceOf(Map);
    if (!current) return;

    expect(current).toMatchObject({
      pid: process.pid,
      processName: expect.any(String)
    });
    if (current.resources?.memoryBytes !== undefined) {
      expect(current.resources.memoryBytes).toBeGreaterThan(0);
    }
    if (current.resources?.threadCount !== undefined) {
      expect(current.resources.threadCount).toBeGreaterThan(0);
    }
  });
});

describe("killProcessTree smoke", () => {
  it("force-kills a disposable localhost server and reports the port closed", async () => {
    const port = await getFreePort();
    const child = spawn(
      process.execPath,
      ["-e", `require('node:http').createServer((_, res) => res.end('ok')).listen(${port}, '127.0.0.1')`],
      {
        stdio: "ignore",
        windowsHide: true
      }
    );
    childPid = child.pid;
    expect(childPid).toBeTypeOf("number");

    await waitForHttp(port);

    const result = await killProcessTree({ pid: childPid!, port, mode: "force-tree" });
    console.info("killProcessTree smoke", JSON.stringify({ platform: process.platform, result }, null, 2));

    expect(result).toMatchObject({ killed: true, pid: childPid, port, portClosed: true });
    childPid = undefined;
  }, 10_000);
});
