import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("validate-native-host-package", () => {
  it("accepts a Linux tarball with the packaged host layout", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "localhost-control-package-"));
    const stageDir = path.join(tempRoot, "stage");
    const artifact = path.join(tempRoot, "host.tar.gz");

    for (const directory of [
      "app/native-host/dist",
      "app/native-host/node_modules/@localhost-control/shared/dist"
    ]) {
      mkdirSync(path.join(stageDir, directory), { recursive: true });
    }

    writeFileSync(path.join(stageDir, "localhost-control-host"), "#!/usr/bin/env sh\n");
    writeFileSync(path.join(stageDir, "install.sh"), "#!/usr/bin/env sh\n");
    writeFileSync(path.join(stageDir, "uninstall.sh"), "#!/usr/bin/env sh\n");
    writeFileSync(path.join(stageDir, "app/native-host/dist/index.js"), "#!/usr/bin/env node\n");
    writeFileSync(path.join(stageDir, "app/native-host/package.json"), "{}\n");
    writeFileSync(path.join(stageDir, "app/native-host/node_modules/@localhost-control/shared/dist/index.js"), "export {};\n");

    execFileSync("tar", ["-czf", artifact, "-C", stageDir, "."], { stdio: "pipe" });
    const output = execFileSync(
      process.execPath,
      [path.join(repoRoot, "scripts", "validate-native-host-package.mjs"), "--platform=linux", "--format=tarball", `--artifact=${artifact}`],
      { encoding: "utf8" }
    );

    expect(output).toContain("Validated");
  });
});
