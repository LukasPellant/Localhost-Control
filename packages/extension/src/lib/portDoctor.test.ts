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
  });

  it("flags duplicate bindings from the same process on the selected port", () => {
    const report = analyzePortDoctor(entry(5173, 100), [entry(5173, 100), { ...entry(5173, 100), address: "::1" }], []);

    expect(report.status).toBe("conflict");
    expect(report.summary).toBe("2 listeners share port 5173");
    expect(report.issues).toContain("PID 100 also listens on port 5173");
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
  });
});
