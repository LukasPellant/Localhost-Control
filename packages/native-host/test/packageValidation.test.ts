import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const padArField = (value: string | number, length: number) => String(value).slice(0, length).padEnd(length, " ");

const writeArArchive = (output: string, entries: { name: string; data: Buffer }[]) => {
  const chunks = [Buffer.from("!<arch>\n")];
  for (const entry of entries) {
    const header = [
      padArField(`${entry.name}/`, 16),
      padArField(0, 12),
      padArField(0, 6),
      padArField(0, 6),
      padArField("100644", 8),
      padArField(entry.data.length, 10),
      "`\n"
    ].join("");
    chunks.push(Buffer.from(header), entry.data);
    if (entry.data.length % 2 === 1) chunks.push(Buffer.from("\n"));
  }
  writeFileSync(output, Buffer.concat(chunks));
};

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

  it("accepts a Debian package with metadata, host files, and system manifests", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "localhost-control-deb-"));
    const controlDir = path.join(tempRoot, "control");
    const dataDir = path.join(tempRoot, "data");
    const controlTar = path.join(tempRoot, "control.tar.gz");
    const dataTar = path.join(tempRoot, "data.tar.gz");
    const artifact = path.join(tempRoot, "host.deb");

    for (const directory of [
      controlDir,
      path.join(dataDir, "usr/lib/localhost-control/app/native-host/dist"),
      path.join(dataDir, "etc/opt/chrome/native-messaging-hosts"),
      path.join(dataDir, "etc/brave/native-messaging-hosts")
    ]) {
      mkdirSync(directory, { recursive: true });
    }

    writeFileSync(
      path.join(controlDir, "control"),
      [
        "Package: localhost-control-native-host",
        "Version: 0.1.2",
        "Architecture: amd64",
        "Depends: nodejs (>= 18)",
        ""
      ].join("\n")
    );
    writeFileSync(path.join(dataDir, "usr/lib/localhost-control/localhost-control-host"), "#!/usr/bin/env sh\n");
    writeFileSync(path.join(dataDir, "usr/lib/localhost-control/app/native-host/dist/index.js"), "#!/usr/bin/env node\n");
    writeFileSync(path.join(dataDir, "etc/opt/chrome/native-messaging-hosts/com.localhost_control.host.json"), "{}\n");
    writeFileSync(path.join(dataDir, "etc/brave/native-messaging-hosts/com.localhost_control.host.json"), "{}\n");

    execFileSync("tar", ["-czf", controlTar, "-C", controlDir, "."], { stdio: "pipe" });
    execFileSync("tar", ["-czf", dataTar, "-C", dataDir, "."], { stdio: "pipe" });
    writeArArchive(artifact, [
      { name: "debian-binary", data: Buffer.from("2.0\n") },
      { name: "control.tar.gz", data: readFileSync(controlTar) },
      { name: "data.tar.gz", data: readFileSync(dataTar) }
    ]);

    const output = execFileSync(
      process.execPath,
      [path.join(repoRoot, "scripts", "validate-native-host-package.mjs"), "--platform=linux", "--format=deb", `--artifact=${artifact}`],
      { encoding: "utf8" }
    );

    expect(output).toContain("Validated");
  });
});
