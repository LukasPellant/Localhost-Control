#!/usr/bin/env node
import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { buildNativeHostManifest, DEFAULT_EXTENSION_ID, DEFAULT_FIREFOX_EXTENSION_ID, resolveNativeMessagingManifestTargets } from "./lib/native-host-manifest.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(path.join(repoRoot, "package.json"), "utf8")));

const parseArgs = () => {
  const args = new Map();
  for (const arg of process.argv.slice(2)) {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    args.set(key, value);
  }
  return args;
};

const copyHostBinary = async (source, destination) => {
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination);
  await chmod(destination, 0o755);
};

const buildRustHost = (platform) => {
  if (platform === "win32" && process.platform !== "win32") {
    throw new Error("Windows Rust native host packages must be built on Windows, or pass --host-binary=/path/to/windows/localhost-control-host.exe.");
  }
  if (platform === "linux" && process.platform !== "linux") {
    throw new Error("Linux Rust native host packages must be built on Linux, or pass --host-binary=/path/to/linux/localhost-control-host.");
  }
  if (platform === "darwin" && process.platform !== "darwin") {
    throw new Error("macOS Rust native host packages must be built on macOS, or pass --host-binary=/path/to/macos/localhost-control-host.");
  }
  const result = spawnSync("cargo", ["build", "--release", "-p", "localhost-control-host"], { cwd: repoRoot, stdio: "inherit" });
  if (result.status !== 0) throw new Error("cargo build failed for localhost-control-host");
  return path.join(repoRoot, "target", "release", process.platform === "win32" ? "localhost-control-host.exe" : "localhost-control-host");
};

const stageRustHostApp = async (stageDir, platform) => {
  await copyHostBinary(buildRustHost(platform), path.join(stageDir, "localhost-control-host"));
};

const stagePath = (rootDir, targetPath) => (rootDir ? path.join(rootDir, targetPath.replace(/^[/\\]+/, "")) : targetPath);

const writeManifestTargets = async ({ platform, scope, rootDir, hostPath, extensionId, firefoxExtensionId }) => {
  const targets = resolveNativeMessagingManifestTargets(platform, scope);
  for (const target of targets) {
    const manifest = buildNativeHostManifest({
      browser: target.browser,
      hostPath,
      extensionId: target.browser === "firefox" ? firefoxExtensionId : extensionId
    });
    const outputPath = stagePath(rootDir, target.path);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
};

const padArField = (value, length) => String(value).slice(0, length).padEnd(length, " ");

const writeArArchive = async (output, entries) => {
  const chunks = [Buffer.from("!<arch>\n")];
  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : await readFile(entry.data);
    const header = [
      padArField(`${entry.name}/`, 16),
      padArField(0, 12),
      padArField(0, 6),
      padArField(0, 6),
      padArField((entry.mode ?? 0o100644).toString(8), 8),
      padArField(data.length, 10),
      "`\n"
    ].join("");
    chunks.push(Buffer.from(header), data);
    if (data.length % 2 === 1) chunks.push(Buffer.from("\n"));
  }
  await writeFile(output, Buffer.concat(chunks));
};

const tarString = (header, offset, length, value) => {
  header.write(String(value).slice(0, length), offset, length, "utf8");
};

const tarOctal = (header, offset, length, value) => {
  const text = value.toString(8).padStart(length - 1, "0").slice(0, length - 1);
  header.write(`${text}\0`, offset, length, "ascii");
};

const writeTarHeader = ({ name, mode, size, type = "0" }) => {
  const header = Buffer.alloc(512, 0);
  tarString(header, 0, 100, name);
  tarOctal(header, 100, 8, mode);
  tarOctal(header, 108, 8, 0);
  tarOctal(header, 116, 8, 0);
  tarOctal(header, 124, 12, size);
  tarOctal(header, 136, 12, 0);
  header.fill(" ", 148, 156);
  tarString(header, 156, 1, type);
  tarString(header, 257, 6, "ustar");
  tarString(header, 263, 2, "00");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  tarOctal(header, 148, 8, checksum);
  return header;
};

const listTarEntries = async (root, relative = "") => {
  const entries = [];
  const items = await import("node:fs/promises").then((fs) => fs.readdir(path.join(root, relative), { withFileTypes: true }));
  for (const item of items.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = path.posix.join(relative.replace(/\\/g, "/"), item.name);
    const fullPath = path.join(root, relativePath);
    if (item.isDirectory()) {
      entries.push({ name: `${relativePath}/`, type: "5", mode: 0o755, data: Buffer.alloc(0) });
      entries.push(...(await listTarEntries(root, relativePath)));
    } else if (item.isFile()) {
      const executableNames = new Set(["localhost-control-host", "postinst", "postrm", "preinst", "prerm"]);
      entries.push({
        name: relativePath,
        type: "0",
        mode: executableNames.has(item.name) ? 0o755 : 0o644,
        data: await readFile(fullPath)
      });
    }
  }
  return entries;
};

const writeTarGzArchive = async (output, root) => {
  const chunks = [];
  for (const entry of await listTarEntries(root)) {
    chunks.push(writeTarHeader({ name: entry.name, mode: entry.mode, size: entry.data.length, type: entry.type }), entry.data);
    const padding = (512 - (entry.data.length % 512)) % 512;
    if (padding) chunks.push(Buffer.alloc(padding, 0));
  }
  chunks.push(Buffer.alloc(1024, 0));
  await writeFile(output, gzipSync(Buffer.concat(chunks)));
};

const packageTarball = async ({ platform, stageDir, outputDir, version }) => {
  const installerDir = platform === "darwin" ? "macos" : "linux";
  await cp(path.join(repoRoot, "installer", installerDir, "install.sh"), path.join(stageDir, "install.sh"));
  await cp(path.join(repoRoot, "installer", installerDir, "uninstall.sh"), path.join(stageDir, "uninstall.sh"));
  await chmod(path.join(stageDir, "install.sh"), 0o755);
  await chmod(path.join(stageDir, "uninstall.sh"), 0o755);
  const label = platform === "darwin" ? "macos" : "linux";
  const output = path.join(outputDir, `localhost-control-native-host-${label}-${version}.tar.gz`);
  const result = spawnSync("tar", ["-czf", output, "-C", stageDir, "."], { stdio: "inherit" });
  if (result.status !== 0) throw new Error("tar packaging failed");
  return output;
};

const packageWindowsZip = async ({ stageDir, outputDir, version }) => {
  await cp(path.join(repoRoot, "installer", "windows", "install.ps1"), path.join(stageDir, "install.ps1"));
  await cp(path.join(repoRoot, "installer", "windows", "uninstall.ps1"), path.join(stageDir, "uninstall.ps1"));
  const output = path.join(outputDir, `localhost-control-native-host-windows-${version}.zip`);
  await rm(output, { force: true });
  const result = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Compress-Archive -Path (Join-Path $env:LOCALHOST_CONTROL_STAGE '*') -DestinationPath $env:LOCALHOST_CONTROL_OUTPUT -Force"
    ],
    {
      env: {
        ...process.env,
        LOCALHOST_CONTROL_STAGE: stageDir,
        LOCALHOST_CONTROL_OUTPUT: output
      },
      stdio: "inherit"
    }
  );
  if (result.status !== 0) throw new Error("Windows zip packaging failed");
  return output;
};

const packageDeb = async ({ stageDir, outputDir, version, arch, extensionId, firefoxExtensionId }) => {
  const dataRoot = path.join(stageDir, "deb-data");
  const controlRoot = path.join(stageDir, "deb-control");
  const installRoot = path.join(dataRoot, "usr", "lib", "localhost-control");
  await mkdir(controlRoot, { recursive: true });
  await mkdir(installRoot, { recursive: true });
  await cp(path.join(stageDir, "localhost-control-host"), path.join(installRoot, "localhost-control-host"));
  await chmod(path.join(installRoot, "localhost-control-host"), 0o755);
  await writeManifestTargets({
    platform: "linux",
    scope: "system",
    rootDir: dataRoot,
    hostPath: "/usr/lib/localhost-control/localhost-control-host",
    extensionId,
    firefoxExtensionId
  });
  await writeFile(
    path.join(controlRoot, "control"),
    [
      "Package: localhost-control-native-host",
      `Version: ${version}`,
      "Section: utils",
      "Priority: optional",
      `Architecture: ${arch}`,
      "Maintainer: Localhost Control <support@localhost-control.local>",
      "Description: Native messaging host for the Localhost Control browser extension",
      ""
    ].join("\n")
  );
  await writeFile(
    path.join(controlRoot, "postinst"),
    [
      "#!/usr/bin/env sh",
      "set -eu",
      "chmod 755 /usr/lib/localhost-control/localhost-control-host",
      ""
    ].join("\n")
  );

  const output = path.join(outputDir, `localhost-control-native-host_${version}_${arch}.deb`);
  const controlTar = path.join(stageDir, "control.tar.gz");
  const dataTar = path.join(stageDir, "data.tar.gz");
  await writeTarGzArchive(controlTar, controlRoot);
  await writeTarGzArchive(dataTar, dataRoot);
  await writeArArchive(output, [
    { name: "debian-binary", data: Buffer.from("2.0\n") },
    { name: "control.tar.gz", data: controlTar },
    { name: "data.tar.gz", data: dataTar }
  ]);
  return output;
};

const packagePkg = async ({ stageDir, outputDir, version, extensionId, firefoxExtensionId }) => {
  const pkgRoot = path.join(stageDir, "pkg-root");
  const installRoot = path.join(pkgRoot, "Library", "Application Support", "Localhost Control");
  await mkdir(installRoot, { recursive: true });
  await cp(path.join(stageDir, "localhost-control-host"), path.join(installRoot, "localhost-control-host"));
  if (await pathExists(path.join(stageDir, "app"))) {
    await cp(path.join(stageDir, "app"), path.join(installRoot, "app"), { recursive: true });
  }
  await chmod(path.join(installRoot, "localhost-control-host"), 0o755);
  await writeManifestTargets({
    platform: "darwin",
    scope: "system",
    rootDir: pkgRoot,
    hostPath: "/Library/Application Support/Localhost Control/localhost-control-host",
    extensionId,
    firefoxExtensionId
  });

  const output = path.join(outputDir, `localhost-control-native-host-${version}.pkg`);
  const result = spawnSync("pkgbuild", ["--root", pkgRoot, "--identifier", "com.localhost-control.native-host", "--version", version, output], { stdio: "inherit" });
  if (result.status !== 0) throw new Error("pkgbuild packaging failed");
  return output;
};

const main = async () => {
  const args = parseArgs();
  const platform = args.get("platform") ?? process.platform;
  const format = args.get("format") ?? (platform === "darwin" ? "pkg" : platform === "win32" ? "zip" : "tarball");
  const arch = args.get("arch") ?? (process.arch === "arm64" ? "arm64" : "amd64");
  const extensionId = args.get("extension-id") ?? DEFAULT_EXTENSION_ID;
  const firefoxExtensionId = args.get("firefox-extension-id") ?? DEFAULT_FIREFOX_EXTENSION_ID;
  const hostBinary = args.get("host-binary") ? path.resolve(args.get("host-binary")) : undefined;
  const outputDir = path.resolve(args.get("out-dir") ?? path.join(repoRoot, "dist", "native-host"));
  const stageDir = path.join(os.tmpdir(), `localhost-control-native-host-${platform}-${Date.now()}`);

  await rm(stageDir, { recursive: true, force: true });
  await mkdir(stageDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  const hostName = platform === "win32" ? path.join("out", "localhost-control-host.exe") : "localhost-control-host";
  if (hostBinary) {
    await copyHostBinary(hostBinary, path.join(stageDir, hostName));
  } else if (platform === "linux" || platform === "darwin") {
    await stageRustHostApp(stageDir, platform);
  } else if (platform === "win32") {
    await copyHostBinary(buildRustHost(platform), path.join(stageDir, hostName));
  } else {
    throw new Error(`Unsupported native host packaging platform: ${platform}`);
  }

  let output;
  if (platform === "win32" && format === "zip") output = await packageWindowsZip({ stageDir, outputDir, version: packageJson.version });
  else if (platform === "darwin" && format === "pkg") output = await packagePkg({ stageDir, outputDir, version: packageJson.version, extensionId, firefoxExtensionId });
  else if (platform === "darwin" && format === "tarball") output = await packageTarball({ platform, stageDir, outputDir, version: packageJson.version });
  else if (platform === "linux" && format === "deb") output = await packageDeb({ stageDir, outputDir, version: packageJson.version, arch, extensionId, firefoxExtensionId });
  else if (platform === "linux" && format === "tarball") output = await packageTarball({ platform, stageDir, outputDir, version: packageJson.version });
  else throw new Error(`Unsupported package target: ${platform}/${format}`);

  console.log(output);
};

const pathExists = async (target) => {
  try {
    await import("node:fs/promises").then((fs) => fs.stat(target));
    return true;
  } catch {
    return false;
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
