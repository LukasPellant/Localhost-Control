import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readInstaller = (name: string) => readFileSync(resolve(__dirname, "../installer/windows", name), "utf8");

describe("Windows native host installer scripts", () => {
  it("uses matching all-browser defaults for install and uninstall", () => {
    expect(readInstaller("install.ps1")).toContain('$Browser = "all"');
    expect(readInstaller("uninstall.ps1")).toContain('$Browser = "all"');
  });
});
