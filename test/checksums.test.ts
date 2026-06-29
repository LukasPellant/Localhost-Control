import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("write-native-host-checksums", () => {
  it("writes SHA256SUMS for native host artifacts", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "localhost-control-checksums-"));
    const artifactDir = path.join(tempRoot, "dist", "native-host");
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(path.join(artifactDir, "sample.tar.gz"), "sample artifact\n");
    writeFileSync(path.join(artifactDir, "ignored.txt"), "not an artifact\n");

    execFileSync(process.execPath, [path.join(repoRoot, "scripts", "write-native-host-checksums.mjs"), `--out-dir=${artifactDir}`], {
      cwd: tempRoot,
      stdio: "pipe"
    });

    const expectedHash = createHash("sha256").update("sample artifact\n").digest("hex");
    expect(readFileSync(path.join(artifactDir, "SHA256SUMS"), "utf8")).toBe(`${expectedHash}  sample.tar.gz\n`);
  });
});
