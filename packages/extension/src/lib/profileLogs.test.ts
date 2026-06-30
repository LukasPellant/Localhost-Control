import { describe, expect, it } from "vitest";
import type { ProjectProfile } from "./projectProfiles";
import { classifyProfileLogLine, formatProfileLogs } from "./profileLogs";

const profile: ProjectProfile = {
  id: "shop",
  name: "Example Shop",
  logLines: ["vite ready in 420ms", "WARN deprecated env", "ERROR failed checkout", "Authorization: Bearer abc123"]
};

describe("profile logs", () => {
  it("classifies recent log lines for compact runtime highlighting", () => {
    expect(classifyProfileLogLine("ERROR failed checkout")).toBe("error");
    expect(classifyProfileLogLine("Warning: deprecated env")).toBe("warning");
    expect(classifyProfileLogLine("GET /health 200")).toBe("info");
  });

  it("formats recent profile logs for clipboard without leaking secrets", () => {
    const text = formatProfileLogs(profile);

    expect(text).toContain("Recent logs for Example Shop");
    expect(text).toContain("- WARN deprecated env");
    expect(text).toContain("- ERROR failed checkout");
    expect(text).toContain("Authorization: Bearer [redacted]");
    expect(text).not.toContain("abc123");
  });

  it("keeps the latest 20 log lines for copied diagnostics", () => {
    const text = formatProfileLogs({
      ...profile,
      logLines: Array.from({ length: 22 }, (_value, index) => `line ${index + 1}`)
    });
    const lines = text.split("\n");

    expect(lines).not.toContain("- line 1");
    expect(lines).not.toContain("- line 2");
    expect(lines).toContain("- line 3");
    expect(lines).toContain("- line 22");
  });
});
