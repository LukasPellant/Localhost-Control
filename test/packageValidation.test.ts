import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const validatorScript = readFileSync(path.join(repoRoot, "scripts", "validate-native-host-package.mjs"), "utf8");
const hostName = "com.localhost_control.host";
const linuxHostPath = "/usr/lib/localhost-control/localhost-control-host";
const chromeExtensionId = "oamllgeaemchejbebgamdakjloahgjdc";
const firefoxExtensionId = "localhost-control@lukaspellant.dev";

const padArField = (value: string | number, length: number) => String(value).slice(0, length).padEnd(length, " ");
const manifestJson = (
  browser: "chrome" | "firefox",
  ids = { chrome: chromeExtensionId, firefox: firefoxExtensionId }
) =>
  `${JSON.stringify(
    {
      name: hostName,
      description: "Localhost Control native messaging host",
      path: linuxHostPath,
      type: "stdio",
      ...(browser === "firefox" ? { allowed_extensions: [ids.firefox] } : { allowed_origins: [`chrome-extension://${ids.chrome}/`] })
    },
    null,
    2
  )}\n`;

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
  it.each([
    { platform: "linux", fileName: "host-linux.tar.gz" },
    { platform: "darwin", fileName: "host-macos.tar.gz" }
  ])("accepts a $platform tarball with the Rust host layout", ({ platform, fileName }) => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "localhost-control-package-"));
    const stageDir = path.join(tempRoot, "stage");
    const artifact = path.join(tempRoot, fileName);

    mkdirSync(stageDir, { recursive: true });
    writeFileSync(path.join(stageDir, "localhost-control-host"), "#!/usr/bin/env sh\n");
    writeFileSync(path.join(stageDir, "install.sh"), readFileSync(path.join(repoRoot, "installer", platform === "darwin" ? "macos" : "linux", "install.sh")));
    writeFileSync(path.join(stageDir, "uninstall.sh"), "#!/usr/bin/env bash\n");

    execFileSync("tar", ["-czf", artifact, "-C", stageDir, "."], { stdio: "pipe" });
    const output = execFileSync(
      process.execPath,
      [path.join(repoRoot, "scripts", "validate-native-host-package.mjs"), `--platform=${platform}`, "--format=tarball", `--artifact=${artifact}`],
      { encoding: "utf8" }
    );

    expect(output).toContain("Validated");
  });

  it.each([
    { platform: "linux", fileName: "host-linux.tar.gz" },
    { platform: "darwin", fileName: "host-macos.tar.gz" }
  ])("rejects a $platform tarball when install.sh does not generate native messaging manifests", ({ platform, fileName }) => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "localhost-control-package-"));
    const stageDir = path.join(tempRoot, "stage");
    const artifact = path.join(tempRoot, fileName);
    const badInstallScript =
      platform === "darwin"
        ? "#!/usr/bin/env bash\nset -euo pipefail\nmkdir -p \"$HOME/Library/Application Support/Localhost Control\"\ncp ./localhost-control-host \"$HOME/Library/Application Support/Localhost Control/localhost-control-host\"\n"
        : "#!/usr/bin/env bash\nset -euo pipefail\nmkdir -p \"$HOME/.local/lib/localhost-control\"\ncp ./localhost-control-host \"$HOME/.local/lib/localhost-control/localhost-control-host\"\n";

    mkdirSync(stageDir, { recursive: true });
    writeFileSync(path.join(stageDir, "localhost-control-host"), "#!/usr/bin/env sh\n");
    writeFileSync(path.join(stageDir, "install.sh"), badInstallScript);
    writeFileSync(path.join(stageDir, "uninstall.sh"), "#!/usr/bin/env bash\n");

    execFileSync("tar", ["-czf", artifact, "-C", stageDir, "."], { stdio: "pipe" });

    expect(() =>
      execFileSync(
        process.execPath,
        [path.join(repoRoot, "scripts", "validate-native-host-package.mjs"), `--platform=${platform}`, "--format=tarball", `--artifact=${artifact}`],
        { encoding: "utf8", stdio: "pipe" }
      )
    ).toThrow(/native messaging manifest/i);
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
      path.join(dataDir, "usr/lib/localhost-control"),
      path.join(dataDir, "etc/opt/chrome/native-messaging-hosts"),
      path.join(dataDir, "etc/brave/native-messaging-hosts"),
      path.join(dataDir, "usr/lib/mozilla/native-messaging-hosts")
    ]) {
      mkdirSync(directory, { recursive: true });
    }

    writeFileSync(path.join(controlDir, "control"), ["Package: localhost-control-native-host", "Version: 0.1.5", "Architecture: amd64", ""].join("\n"));
    writeFileSync(path.join(controlDir, "postinst"), "#!/usr/bin/env sh\nchmod 755 /usr/lib/localhost-control/localhost-control-host\n");
    writeFileSync(path.join(dataDir, "usr/lib/localhost-control/localhost-control-host"), "#!/usr/bin/env sh\n");
    writeFileSync(path.join(dataDir, "etc/opt/chrome/native-messaging-hosts/com.localhost_control.host.json"), manifestJson("chrome"));
    writeFileSync(path.join(dataDir, "etc/brave/native-messaging-hosts/com.localhost_control.host.json"), manifestJson("chrome"));
    writeFileSync(path.join(dataDir, "usr/lib/mozilla/native-messaging-hosts/com.localhost_control.host.json"), manifestJson("firefox"));

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

  it("accepts a Windows zip with installer scripts and the Rust host binary", () => {
    if (process.platform !== "win32") return;

    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "localhost-control-winzip-"));
    const stageDir = path.join(tempRoot, "stage");
    const artifact = path.join(tempRoot, "host-windows.zip");

    mkdirSync(path.join(stageDir, "out"), { recursive: true });
    writeFileSync(path.join(stageDir, "install.ps1"), "$ErrorActionPreference = 'Stop'\n");
    writeFileSync(path.join(stageDir, "uninstall.ps1"), "$ErrorActionPreference = 'Stop'\n");
    writeFileSync(path.join(stageDir, "out", "localhost-control-host.exe"), "rust-host\n");

    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "Compress-Archive -Path (Join-Path $env:LOCALHOST_CONTROL_STAGE '*') -DestinationPath $env:LOCALHOST_CONTROL_ARTIFACT -Force"
      ],
      {
        stdio: "pipe",
        env: {
          ...process.env,
          LOCALHOST_CONTROL_STAGE: stageDir,
          LOCALHOST_CONTROL_ARTIFACT: artifact
        }
      }
    );

    const output = execFileSync(
      process.execPath,
      [path.join(repoRoot, "scripts", "validate-native-host-package.mjs"), "--platform=win32", `--artifact=${artifact}`],
      { encoding: "utf8" }
    );

    expect(output).toContain("Validated");
  });

  it("validates macOS pkg native messaging manifest contents after expanding the payload", () => {
    const validatePkg = validatorScript.match(/const validatePkg = async \(\) => \{[\s\S]*?\n\};/)
      ?? validatorScript.match(/const validatePkg = \(\) => \{[\s\S]*?\n\};/);
    expect(validatePkg?.[0]).toContain("--expand-full");
    expect(validatePkg?.[0]).toContain("validateNativeManifestBySuffix");
    expect(validatePkg?.[0]).toContain("macosHostPath");
    expect(validatorScript).toContain('const macosHostPath = "/Library/Application Support/Localhost Control/localhost-control-host"');
  });

  it("rejects a Debian package that cannot restore the host executable permission", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "localhost-control-deb-"));
    const controlDir = path.join(tempRoot, "control");
    const dataDir = path.join(tempRoot, "data");
    const controlTar = path.join(tempRoot, "control.tar.gz");
    const dataTar = path.join(tempRoot, "data.tar.gz");
    const artifact = path.join(tempRoot, "host.deb");

    for (const directory of [
      controlDir,
      path.join(dataDir, "usr/lib/localhost-control"),
      path.join(dataDir, "etc/opt/chrome/native-messaging-hosts"),
      path.join(dataDir, "etc/brave/native-messaging-hosts"),
      path.join(dataDir, "usr/lib/mozilla/native-messaging-hosts")
    ]) {
      mkdirSync(directory, { recursive: true });
    }

    writeFileSync(path.join(controlDir, "control"), ["Package: localhost-control-native-host", "Version: 0.1.5", "Architecture: amd64", ""].join("\n"));
    writeFileSync(path.join(dataDir, "usr/lib/localhost-control/localhost-control-host"), "#!/usr/bin/env sh\n");
    writeFileSync(path.join(dataDir, "etc/opt/chrome/native-messaging-hosts/com.localhost_control.host.json"), "{}\n");
    writeFileSync(path.join(dataDir, "etc/brave/native-messaging-hosts/com.localhost_control.host.json"), "{}\n");
    writeFileSync(path.join(dataDir, "usr/lib/mozilla/native-messaging-hosts/com.localhost_control.host.json"), "{}\n");

    execFileSync("tar", ["-czf", controlTar, "-C", controlDir, "."], { stdio: "pipe" });
    execFileSync("tar", ["-czf", dataTar, "-C", dataDir, "."], { stdio: "pipe" });
    writeArArchive(artifact, [
      { name: "debian-binary", data: Buffer.from("2.0\n") },
      { name: "control.tar.gz", data: readFileSync(controlTar) },
      { name: "data.tar.gz", data: readFileSync(dataTar) }
    ]);

    expect(() =>
      execFileSync(
        process.execPath,
        [path.join(repoRoot, "scripts", "validate-native-host-package.mjs"), "--platform=linux", "--format=deb", `--artifact=${artifact}`],
        { encoding: "utf8", stdio: "pipe" }
      )
    ).toThrow(/postinst/);
  });

  it("rejects a Debian package with invalid native messaging manifests", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "localhost-control-deb-"));
    const controlDir = path.join(tempRoot, "control");
    const dataDir = path.join(tempRoot, "data");
    const controlTar = path.join(tempRoot, "control.tar.gz");
    const dataTar = path.join(tempRoot, "data.tar.gz");
    const artifact = path.join(tempRoot, "host.deb");

    for (const directory of [
      controlDir,
      path.join(dataDir, "usr/lib/localhost-control"),
      path.join(dataDir, "etc/opt/chrome/native-messaging-hosts"),
      path.join(dataDir, "etc/brave/native-messaging-hosts"),
      path.join(dataDir, "usr/lib/mozilla/native-messaging-hosts")
    ]) {
      mkdirSync(directory, { recursive: true });
    }

    writeFileSync(path.join(controlDir, "control"), ["Package: localhost-control-native-host", "Version: 0.1.5", "Architecture: amd64", ""].join("\n"));
    writeFileSync(path.join(controlDir, "postinst"), "#!/usr/bin/env sh\nchmod 755 /usr/lib/localhost-control/localhost-control-host\n");
    writeFileSync(path.join(dataDir, "usr/lib/localhost-control/localhost-control-host"), "#!/usr/bin/env sh\n");
    writeFileSync(path.join(dataDir, "etc/opt/chrome/native-messaging-hosts/com.localhost_control.host.json"), "{}\n");
    writeFileSync(path.join(dataDir, "etc/brave/native-messaging-hosts/com.localhost_control.host.json"), "{}\n");
    writeFileSync(path.join(dataDir, "usr/lib/mozilla/native-messaging-hosts/com.localhost_control.host.json"), "{}\n");

    execFileSync("tar", ["-czf", controlTar, "-C", controlDir, "."], { stdio: "pipe" });
    execFileSync("tar", ["-czf", dataTar, "-C", dataDir, "."], { stdio: "pipe" });
    writeArArchive(artifact, [
      { name: "debian-binary", data: Buffer.from("2.0\n") },
      { name: "control.tar.gz", data: readFileSync(controlTar) },
      { name: "data.tar.gz", data: readFileSync(dataTar) }
    ]);

    expect(() =>
      execFileSync(
        process.execPath,
        [path.join(repoRoot, "scripts", "validate-native-host-package.mjs"), "--platform=linux", "--format=deb", `--artifact=${artifact}`],
        { encoding: "utf8", stdio: "pipe" }
      )
    ).toThrow(/native messaging manifest/i);
  });

  it("accepts a Debian package with custom native messaging extension ids", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "localhost-control-deb-"));
    const controlDir = path.join(tempRoot, "control");
    const dataDir = path.join(tempRoot, "data");
    const controlTar = path.join(tempRoot, "control.tar.gz");
    const dataTar = path.join(tempRoot, "data.tar.gz");
    const artifact = path.join(tempRoot, "host.deb");
    const ids = {
      chrome: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      firefox: "custom-localhost-control@example.test"
    };

    for (const directory of [
      controlDir,
      path.join(dataDir, "usr/lib/localhost-control"),
      path.join(dataDir, "etc/opt/chrome/native-messaging-hosts"),
      path.join(dataDir, "etc/brave/native-messaging-hosts"),
      path.join(dataDir, "usr/lib/mozilla/native-messaging-hosts")
    ]) {
      mkdirSync(directory, { recursive: true });
    }

    writeFileSync(path.join(controlDir, "control"), ["Package: localhost-control-native-host", "Version: 0.1.5", "Architecture: amd64", ""].join("\n"));
    writeFileSync(path.join(controlDir, "postinst"), "#!/usr/bin/env sh\nchmod 755 /usr/lib/localhost-control/localhost-control-host\n");
    writeFileSync(path.join(dataDir, "usr/lib/localhost-control/localhost-control-host"), "#!/usr/bin/env sh\n");
    writeFileSync(path.join(dataDir, "etc/opt/chrome/native-messaging-hosts/com.localhost_control.host.json"), manifestJson("chrome", ids));
    writeFileSync(path.join(dataDir, "etc/brave/native-messaging-hosts/com.localhost_control.host.json"), manifestJson("chrome", ids));
    writeFileSync(path.join(dataDir, "usr/lib/mozilla/native-messaging-hosts/com.localhost_control.host.json"), manifestJson("firefox", ids));

    execFileSync("tar", ["-czf", controlTar, "-C", controlDir, "."], { stdio: "pipe" });
    execFileSync("tar", ["-czf", dataTar, "-C", dataDir, "."], { stdio: "pipe" });
    writeArArchive(artifact, [
      { name: "debian-binary", data: Buffer.from("2.0\n") },
      { name: "control.tar.gz", data: readFileSync(controlTar) },
      { name: "data.tar.gz", data: readFileSync(dataTar) }
    ]);

    const output = execFileSync(
      process.execPath,
      [
        path.join(repoRoot, "scripts", "validate-native-host-package.mjs"),
        "--platform=linux",
        "--format=deb",
        `--artifact=${artifact}`,
        `--extension-id=${ids.chrome}`,
        `--firefox-extension-id=${ids.firefox}`
      ],
      { encoding: "utf8" }
    );

    expect(output).toContain("Validated");
  });
});
