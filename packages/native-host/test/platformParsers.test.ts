import { describe, expect, it } from "vitest";
import { parseLsofListeners } from "../src/platform/darwin/netstat";
import { parseDarwinPsOutput } from "../src/platform/darwin/processMetadata";
import { parseSsListeners } from "../src/platform/linux/netstat";
import { parseLinuxPsOutput } from "../src/platform/linux/processMetadata";

describe("parseLsofListeners", () => {
  it("parses macOS lsof listen rows with loopback, wildcard, and IPv6 addresses", () => {
    const output = `
COMMAND   PID  USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
node     1234 pella   21u  IPv4 0xabcdef1234567890      0t0  TCP 127.0.0.1:5173 (LISTEN)
Python   2222 pella    5u  IPv6 0xabcdef1234567891      0t0  TCP *:8000 (LISTEN)
node     3333 pella   22u  IPv6 0xabcdef1234567892      0t0  TCP [::1]:3000 (LISTEN)
`;

    expect(parseLsofListeners(output)).toEqual([
      { address: "127.0.0.1", port: 5173, pid: 1234 },
      { address: "0.0.0.0", port: 8000, pid: 2222 },
      { address: "::1", port: 3000, pid: 3333 }
    ]);
  });
});

describe("parseSsListeners", () => {
  it("parses Linux ss listen rows with IPv4, IPv6, wildcard, and missing PID rows", () => {
    const output = `
LISTEN 0 511 127.0.0.1:5173 0.0.0.0:* users:(("node",pid=1234,fd=21))
LISTEN 0 128 [::1]:3000 [::]:* users:(("node",pid=3333,fd=21))
LISTEN 0 4096 *:8000 *:* users:(("python3",pid=2222,fd=3))
LISTEN 0 4096 0.0.0.0:631 0.0.0.0:*
`;

    expect(parseSsListeners(output)).toEqual([
      { address: "127.0.0.1", port: 5173, pid: 1234 },
      { address: "::1", port: 3000, pid: 3333 },
      { address: "0.0.0.0", port: 8000, pid: 2222 }
    ]);
  });
});

describe("parseDarwinPsOutput", () => {
  it("maps macOS ps rows into process metadata and resource counters", () => {
    const output = `
  PID  PPID COMM             ELAPSED  %CPU   RSS THCNT COMMAND
 1234     1 node             01:02:03   7.5 51200    18 node /Users/pella/dev/app/node_modules/.bin/vite --host 127.0.0.1
`;

    const metadata = parseDarwinPsOutput(output, new Map([[1234, "/opt/homebrew/bin/node"]]));
    expect(metadata.get(1234)).toMatchObject({
      pid: 1234,
      parentPid: 1,
      processName: "node",
      executablePath: "/opt/homebrew/bin/node",
      commandLine: "node /Users/pella/dev/app/node_modules/.bin/vite --host 127.0.0.1",
      projectHint: "/Users/pella/dev/app",
      resources: {
        cpuPercent: 7.5,
        memoryBytes: 52_428_800,
        threadCount: 18,
        uptimeMs: 3_723_000
      }
    });
  });

  it("parses macOS ps rows when thread count is not available", () => {
    const output = `
  PID  PPID COMM             ELAPSED  %CPU   RSS COMMAND
 1234     1 node             01:02:03   7.5 51200 node /Users/pella/dev/app/node_modules/.bin/vite --host 127.0.0.1
`;

    expect(parseDarwinPsOutput(output).get(1234)).toMatchObject({
      pid: 1234,
      parentPid: 1,
      processName: "node",
      resources: {
        cpuPercent: 7.5,
        memoryBytes: 52_428_800,
        uptimeMs: 3_723_000
      }
    });
    expect(parseDarwinPsOutput(output).get(1234)?.resources?.threadCount).toBeUndefined();
  });
});

describe("parseLinuxPsOutput", () => {
  it("maps Linux ps rows into process metadata and /proc-backed paths", () => {
    const output = `
  PID  PPID COMMAND          ELAPSED %CPU   RSS NLWP COMMAND
 2222  1000 python3             3661  0.4 32768    4 python3 -m http.server 8000
`;
    const executableByPid = new Map([[2222, "/usr/bin/python3"]]);
    const cwdByPid = new Map([[2222, "/home/pella/projects/demo"]]);

    const metadata = parseLinuxPsOutput(output, executableByPid, cwdByPid);
    expect(metadata.get(2222)).toMatchObject({
      pid: 2222,
      parentPid: 1000,
      processName: "python3",
      executablePath: "/usr/bin/python3",
      commandLine: "python3 -m http.server 8000",
      projectHint: "/home/pella/projects/demo",
      resources: {
        cpuPercent: 0.4,
        memoryBytes: 33_554_432,
        threadCount: 4,
        uptimeMs: 3_661_000
      }
    });
  });

  it("maps Linux ps rows when thread count is not available", () => {
    const output = `
 2222  1000 python3             3661  0.4 32768 python3 -m http.server 8000
`;

    const metadata = parseLinuxPsOutput(output);
    expect(metadata.get(2222)).toMatchObject({
      pid: 2222,
      parentPid: 1000,
      processName: "python3",
      commandLine: "python3 -m http.server 8000",
      resources: {
        cpuPercent: 0.4,
        memoryBytes: 33_554_432,
        uptimeMs: 3_661_000
      }
    });
    expect(metadata.get(2222)?.resources?.threadCount).toBeUndefined();
  });
});
