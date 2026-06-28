import { describe, expect, it } from "vitest";
import { buildPortEntries } from "../src/scanner";

describe("buildPortEntries", () => {
  it("merges listeners, process metadata, probes, classification, and protection", async () => {
    const entries = await buildPortEntries(
      [
        { address: "127.0.0.1", port: 5173, pid: 100 },
        { address: "0.0.0.0", port: 135, pid: 4 }
      ],
      new Map([
        [
          100,
          {
            pid: 100,
            parentPid: 88,
            processName: "node.exe",
            executablePath: "C:\\Program Files\\nodejs\\node.exe",
            commandLine: "node vite --host 127.0.0.1",
            projectHint: "D:\\DevelopmentD\\DrawCreator",
            resources: {
              cpuPercent: 12.4,
              memoryBytes: 312_000_000,
              privateMemoryBytes: 188_000_000,
              threadCount: 22,
              handleCount: 240,
              uptimeMs: 90_000
            }
          }
        ],
        [4, { pid: 4, parentPid: 0, processName: "System", executablePath: "C:\\Windows\\System32\\ntoskrnl.exe" }]
      ]),
      new Map([[5173, { url: "http://127.0.0.1:5173", statusCode: 200, title: "Vite App" }]])
    );

    expect(entries[0]).toMatchObject({
      port: 5173,
      pid: 100,
      detectedKind: "vite",
      confidence: "high",
      killable: true,
      title: "Vite App",
      projectHint: "D:\\DevelopmentD\\DrawCreator",
      resources: {
        cpuPercent: 12.4,
        memoryBytes: 312_000_000,
        privateMemoryBytes: 188_000_000,
        threadCount: 22,
        handleCount: 240,
        uptimeMs: 90_000
      }
    });
    expect(entries[1]).toMatchObject({
      port: 135,
      pid: 4,
      killable: false,
      protectionReason: expect.any(String)
    });
  });
});
