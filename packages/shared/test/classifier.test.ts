import { describe, expect, it } from "vitest";
import { classifyPort, protectPortEntry, scopePortEntry } from "../src/index";

describe("port classifier", () => {
  it("classifies common dev server command lines", () => {
    expect(classifyPort({ port: 5173, processName: "node.exe", commandLine: "node vite --host 127.0.0.1" })).toMatchObject({
      detectedKind: "vite",
      confidence: "high"
    });
    expect(classifyPort({ port: 3000, processName: "node.exe", commandLine: "next dev" })).toMatchObject({
      detectedKind: "next",
      confidence: "high"
    });
    expect(classifyPort({ port: 3210, processName: "node.exe", commandLine: "convex dev" })).toMatchObject({
      detectedKind: "convex",
      confidence: "high"
    });
    expect(classifyPort({ port: 8000, processName: "python.exe", commandLine: "python -m http.server 8000" })).toMatchObject({
      detectedKind: "python",
      confidence: "high"
    });
  });

  it("protects system-risk processes and permits likely dev servers", () => {
    expect(
      protectPortEntry({
        port: 135,
        pid: 4,
        processName: "System",
        executablePath: "C:\\Windows\\System32\\ntoskrnl.exe",
        detectedKind: "unknown",
        confidence: "low"
      })
    ).toMatchObject({ killable: false, protectionReason: expect.stringContaining("system") });

    expect(
      protectPortEntry({
        port: 5173,
        pid: 1000,
        processName: "node.exe",
        executablePath: "C:\\Program Files\\nodejs\\node.exe",
        detectedKind: "vite",
        confidence: "high"
      })
    ).toMatchObject({ killable: true });
  });

  it("scopes trusted project listeners separately from local app services", () => {
    const policy = {
      trustedProjectRoots: ["D:\\DevelopmentD"],
      trustedProjectPaths: [],
      blockedProcessNames: ["steam.exe", "discord.exe"]
    };

    expect(
      scopePortEntry(
        {
          port: 5173,
          address: "127.0.0.1",
          pid: 100,
          processName: "node.exe",
          projectHint: "D:\\DevelopmentD\\DrawCreator",
          detectedKind: "vite",
          confidence: "high",
          killable: true
        },
        policy
      )
    ).toBe("dev-app");

    expect(
      scopePortEntry(
        {
          port: 3515,
          address: "127.0.0.1",
          pid: 200,
          processName: "steam.exe",
          projectHint: "C:\\Program Files (x86)\\Steam",
          detectedKind: "static",
          confidence: "medium",
          killable: true
        },
        policy
      )
    ).toBe("local-service");

    expect(
      scopePortEntry(
        {
          port: 135,
          address: "0.0.0.0",
          pid: 4,
          processName: "System",
          detectedKind: "unknown",
          confidence: "low",
          killable: false,
          protectionReason: "Protected system process"
        },
        policy
      )
    ).toBe("protected");
  });
});
