import { describe, expect, it } from "vitest";
import type { PortEntry } from "@localhost-control/shared";
import { analyzePortDoctor } from "./portDoctor";
import type { ProjectProfile } from "./projectProfiles";

const entry = (port: number, pid: number, title = `App ${port}`): PortEntry => ({
  port,
  address: "127.0.0.1",
  pid,
  processName: "node.exe",
  commandLine: `node dev --port ${port}`,
  detectedKind: "node",
  confidence: "high",
  killable: true,
  title,
  url: `http://127.0.0.1:${port}`,
  statusCode: 200
});

describe("port doctor", () => {
  it("flags duplicate listeners and suggests the next free development port", () => {
    const report = analyzePortDoctor(entry(5173, 100), [entry(5173, 100), entry(5173, 101), entry(5174, 200)], []);

    expect(report.status).toBe("conflict");
    expect(report.summary).toBe("2 listeners share port 5173");
    expect(report.nextFreePort).toBe(5175);
    expect(report.issues).toContain("PID 101 also listens on port 5173");
    expect(report.advice).toEqual([
      "Confirm which listener should own http://127.0.0.1:5173.",
      "Stop PID 101 or move one app to port 5175.",
      "Fallback command: node dev --port 5175"
    ]);
  });

  it("flags duplicate bindings from the same process on the selected port", () => {
    const report = analyzePortDoctor(entry(5173, 100), [entry(5173, 100), { ...entry(5173, 100), address: "::1" }], []);

    expect(report.status).toBe("conflict");
    expect(report.summary).toBe("2 listeners share port 5173");
    expect(report.issues).toContain("PID 100 also listens on port 5173");
  });

  it("keeps fallback command advice conservative and redacts command secrets", () => {
    const noExplicitPort = analyzePortDoctor(
      { ...entry(5173, 100), commandLine: "node vite --token hunter2" },
      [{ ...entry(5173, 100), commandLine: "node vite --token hunter2" }, entry(5173, 101), entry(5174, 200)],
      []
    );
    const explicitPort = analyzePortDoctor(
      { ...entry(5173, 100), commandLine: "vite --port=5173 OPENAI_API_KEY=sk-local" },
      [{ ...entry(5173, 100), commandLine: "vite --port=5173 OPENAI_API_KEY=sk-local" }, entry(5173, 101), entry(5174, 200)],
      []
    );

    expect(noExplicitPort.advice).toContain("Fallback command: node vite --token [redacted]");
    expect(noExplicitPort.advice).not.toContain("node vite --token hunter2 --port 5175");
    expect(explicitPort.advice).toContain("Fallback command: vite --port=5175 OPENAI_API_KEY=[redacted]");
    expect(explicitPort.advice.join("\n")).not.toContain("sk-local");
  });

  it("redacts sensitive URL query values in advice", () => {
    const report = analyzePortDoctor(
      { ...entry(5173, 100), url: "http://127.0.0.1:5173/app?token=hunter2&mode=dev" },
      [{ ...entry(5173, 100), url: "http://127.0.0.1:5173/app?token=hunter2&mode=dev" }, entry(5173, 101)],
      []
    );

    expect(report.advice).toContain("Confirm which listener should own http://127.0.0.1:5173/app?token=[redacted]&mode=dev.");
    expect(report.advice.join("\n")).not.toContain("hunter2");
  });

  it("redacts equals-style secret flags in fallback commands", () => {
    const report = analyzePortDoctor(
      { ...entry(5173, 100), commandLine: "vite --port 5173 --token=hunter2 --api-key=sk-local" },
      [{ ...entry(5173, 100), commandLine: "vite --port 5173 --token=hunter2 --api-key=sk-local" }, entry(5173, 101)],
      []
    );

    expect(report.advice).toContain("Fallback command: vite --port 5174 --token=[redacted] --api-key=[redacted]");
    expect(report.advice.join("\n")).not.toContain("hunter2");
    expect(report.advice.join("\n")).not.toContain("sk-local");
  });

  it("detects when a port belongs to a different saved profile", () => {
    const profiles: ProjectProfile[] = [
      { id: "shop", name: "Example Shop", expectedPort: 5173 },
      { id: "api", name: "Local API", expectedPort: 17321 }
    ];

    const report = analyzePortDoctor(entry(5173, 100, "Unknown dev server"), [entry(5173, 100)], profiles, "api");

    expect(report.status).toBe("attention");
    expect(report.summary).toBe("5173 is reserved for Example Shop");
    expect(report.issues).toEqual(["Saved profile Example Shop expects port 5173."]);
    expect(report.nextFreePort).toBe(5174);
    expect(report.advice).toEqual([
      "Example Shop owns the saved reservation for port 5173.",
      "Move this process to port 5174 or stop it before starting Example Shop.",
      "Fallback command: node dev --port 5174"
    ]);
  });
});
