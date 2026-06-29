import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = readFileSync(resolve(__dirname, "../scripts/package-extension.ps1"), "utf8");

describe("package-extension.ps1", () => {
  it("prepares and zips an isolated staging directory for each target", () => {
    expect(script).toContain("$StageDir");
    expect(script).toContain('"--dist-dir=$StageDir"');
    expect(script).toContain('Compress-Archive -Path (Join-Path $StageDir "*")');
    expect(script).not.toContain('Compress-Archive -Path (Join-Path $DistDir "*")');
  });
});
