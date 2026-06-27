import { describe, expect, it } from "vitest";
import { classifyPort, protectPortEntry } from "../src/index";

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
});
