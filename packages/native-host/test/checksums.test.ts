import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

describe("write-native-host-checksums", () => {
  it("writes SHA256SUMS for native host artifacts", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "localhost-control-checksums-"));
    const artifactDir = path.join(tempRoot, "dist", "native-host");
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(path.join(artifactDir, "sample.tar.gz"), "sample artifact\n");
    writeFileSync(path.join(artifactDir, "ignored.txt"), "not an artifact\n");

    const script = path.resolve(__dirname, "..", "..", "..", "scripts", "write-native-host-checksums.mjs");
    execFileSync(process.execPath, [script, `--out-dir=${artifactDir}`], { cwd: tempRoot, stdio: "pipe" });

    const expectedHash = createHash("sha256").update("sample artifact\n").digest("hex");
    expect(readFileSync(path.join(artifactDir, "SHA256SUMS"), "utf8")).toBe(`${expectedHash}  sample.tar.gz\n`);
  });
});
