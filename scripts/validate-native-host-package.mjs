#!/usr/bin/env node
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
const hostName = "com.localhost_control.host";
const defaultExtensionId = "oamllgeaemchejbebgamdakjloahgjdc";
const defaultFirefoxExtensionId = "localhost-control@lukaspellant.dev";
const linuxHostPath = "/usr/lib/localhost-control/localhost-control-host";
const macosHostPath = "/Library/Application Support/Localhost Control/localhost-control-host";

const parseArgs = () => {
  const args = new Map();
  for (const arg of process.argv.slice(2)) {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    args.set(key, value);
  }
  return args;
};

const args = parseArgs();
const platform = args.get("platform") ?? process.platform;
const format = args.get("format") ?? (platform === "darwin" ? "pkg" : platform === "win32" ? "zip" : "tarball");
const arch = args.get("arch") ?? (process.arch === "arm64" ? "arm64" : "amd64");
const outputDir = path.resolve(args.get("out-dir") ?? path.join(repoRoot, "dist", "native-host"));
const expectedExtensionId = args.get("extension-id") ?? defaultExtensionId;
const expectedFirefoxExtensionId = args.get("firefox-extension-id") ?? defaultFirefoxExtensionId;

const defaultArtifactPath = () => {
  if (platform === "darwin" && format === "pkg") {
    return path.join(outputDir, `localhost-control-native-host-${packageJson.version}.pkg`);
  }
  if (platform === "darwin" && format === "tarball") {
    return path.join(outputDir, `localhost-control-native-host-macos-${packageJson.version}.tar.gz`);
  }
  if (platform === "linux" && format === "tarball") {
    return path.join(outputDir, `localhost-control-native-host-linux-${packageJson.version}.tar.gz`);
  }
  if (platform === "win32" && format === "zip") {
    return path.join(outputDir, `localhost-control-native-host-windows-${packageJson.version}.zip`);
  }
  if (platform === "linux" && format === "deb") {
    return path.join(outputDir, `localhost-control-native-host_${packageJson.version}_${arch}.deb`);
  }
  throw new Error(`Unsupported package target: ${platform}/${format}`);
};

const artifact = path.resolve(args.get("artifact") ?? defaultArtifactPath());

const run = (command, commandArgs, env = {}, cwd = undefined) => {
  const result = spawnSync(command, commandArgs, { cwd, encoding: "utf8", env: { ...process.env, ...env } });
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${command} ${commandArgs.join(" ")} failed${details ? `\n${details}` : ""}`);
  }
  return result.stdout;
};

let cachedBashFlavor;
const bashFlavor = () => {
  cachedBashFlavor ??= run("bash", ["-c", "uname -s"]).trim().toLowerCase();
  return cachedBashFlavor;
};

const shellQuote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;

const extractArArchive = (buffer) => {
  if (buffer.subarray(0, 8).toString() !== "!<arch>\n") {
    throw new Error("Debian package is missing the ar archive header.");
  }

  const entries = new Map();
  let offset = 8;
  while (offset < buffer.length) {
    const header = buffer.subarray(offset, offset + 60);
    if (header.length < 60) throw new Error("Debian package has a truncated ar entry header.");
    const rawName = header.subarray(0, 16).toString().trim();
    const name = rawName.endsWith("/") ? rawName.slice(0, -1) : rawName;
    const size = Number(header.subarray(48, 58).toString().trim());
    if (!Number.isInteger(size) || size < 0) throw new Error(`Debian package has an invalid ar entry size for ${name}.`);
    const dataStart = offset + 60;
    const dataEnd = dataStart + size;
    entries.set(name, buffer.subarray(dataStart, dataEnd));
    offset = dataEnd + (size % 2);
  }
  return entries;
};

const listTarGzEntries = async (buffer, tempRoot, fileName) => {
  const archivePath = path.join(tempRoot, fileName);
  await writeFile(archivePath, buffer);
  return run("tar", ["-tzf", archivePath]).split(/\r?\n/).filter(Boolean);
};

const extractTarGz = async (buffer, tempRoot, fileName, outputDir) => {
  const archivePath = path.join(tempRoot, fileName);
  await writeFile(archivePath, buffer);
  await mkdir(outputDir, { recursive: true });
  run("tar", ["-xzf", archivePath, "-C", outputDir]);
};

const removeTempRoot = async (tempRoot) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(tempRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!["EBUSY", "ENOTEMPTY", "EPERM"].includes(error?.code)) throw error;
      await delay(100 * (attempt + 1));
    }
  }
};

const toBashPath = (filePath) => {
  if (process.platform !== "win32") return filePath;
  const normalized = filePath.replace(/\\/g, "/");
  const match = /^([A-Za-z]):\/(.*)$/.exec(normalized);
  if (!match) return normalized;
  const [, drive, rest] = match;
  return bashFlavor().includes("mingw") || bashFlavor().includes("msys") || bashFlavor().includes("cygwin")
    ? `/${drive.toLowerCase()}/${rest}`
    : `/mnt/${drive.toLowerCase()}/${rest}`;
};

const normalizeEntry = (entry) => entry.trim().replace(/\\/g, "/").replace(/^\.\//, "");

const requireEntry = (entries, expectedSuffix) => {
  if (!entries.some((entry) => normalizeEntry(entry).endsWith(expectedSuffix))) {
    throw new Error(`Missing package entry: ${expectedSuffix}`);
  }
};

const assertArrayEquals = (actual, expected, message) => {
  if (!Array.isArray(actual) || actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(message);
  }
};

const findFileBySuffix = async (root, expectedSuffix, relative = "") => {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.posix.join(relative.replace(/\\/g, "/"), entry.name);
    const fullPath = path.join(root, ...entryPath.split("/"));
    if (entry.isDirectory()) {
      const match = await findFileBySuffix(root, expectedSuffix, entryPath);
      if (match) return match;
    } else if (entry.isFile() && normalizeEntry(entryPath).endsWith(expectedSuffix)) {
      return fullPath;
    }
  }
  return null;
};

const validateNativeManifestFile = async (root, relativePath, browser, expectedHostPath = linuxHostPath) => {
  const fullPath = path.join(root, ...relativePath.split("/"));
  await validateNativeManifestPath(fullPath, relativePath, browser, expectedHostPath);
};

const validateNativeManifestBySuffix = async (root, relativePath, browser, expectedHostPath) => {
  const fullPath = await findFileBySuffix(root, relativePath);
  if (!fullPath) throw new Error(`Invalid native messaging manifest: ${relativePath}`);
  await validateNativeManifestPath(fullPath, relativePath, browser, expectedHostPath);
};

const validateNativeManifestPath = async (fullPath, relativePath, browser, expectedHostPath) => {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(fullPath, "utf8"));
  } catch {
    throw new Error(`Invalid native messaging manifest: ${relativePath}`);
  }

  if (manifest.name !== hostName || manifest.description !== "Localhost Control native messaging host" || manifest.path !== expectedHostPath || manifest.type !== "stdio") {
    throw new Error(`Invalid native messaging manifest: ${relativePath}`);
  }

  if (browser === "firefox") {
    assertArrayEquals(
      manifest.allowed_extensions,
      [expectedFirefoxExtensionId],
      `Invalid native messaging manifest: ${relativePath}`
    );
    return;
  }

  assertArrayEquals(
    manifest.allowed_origins,
    [`chrome-extension://${expectedExtensionId}/`],
    `Invalid native messaging manifest: ${relativePath}`
  );
};

const validateTarballInstall = async (extractRoot, tempRoot) => {
  const installScript = await findFileBySuffix(extractRoot, "install.sh");
  if (!installScript) throw new Error("Missing package entry: install.sh");

  const packageRoot = path.dirname(installScript);
  const homeDir = path.join(tempRoot, "home");
  await mkdir(homeDir, { recursive: true });
  const bashHome = toBashPath(homeDir);

  run(
    "bash",
    [
      "-c",
      [
        `export HOME=${shellQuote(bashHome)}`,
        `export EXTENSION_ID=${shellQuote(expectedExtensionId)}`,
        `export FIREFOX_EXTENSION_ID=${shellQuote(expectedFirefoxExtensionId)}`,
        "bash ./install.sh"
      ].join("; ")
    ],
    {},
    packageRoot
  );

  const hostTarget =
    platform === "darwin"
      ? path.join(homeDir, "Library/Application Support/Localhost Control/localhost-control-host")
      : path.join(homeDir, ".local/lib/localhost-control/localhost-control-host");
  const expectedHostPath =
    platform === "darwin"
      ? `${bashHome}/Library/Application Support/Localhost Control/localhost-control-host`
      : `${bashHome}/.local/lib/localhost-control/localhost-control-host`;

  await access(hostTarget).catch(() => {
    throw new Error("Tarball installer did not install localhost-control-host.");
  });

  const manifests =
    platform === "darwin"
      ? [
          {
            relativePath: "Library/Application Support/Google/Chrome/NativeMessagingHosts/com.localhost_control.host.json",
            browser: "chrome"
          },
          {
            relativePath: "Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.localhost_control.host.json",
            browser: "brave"
          },
          {
            relativePath: "Library/Application Support/Mozilla/NativeMessagingHosts/com.localhost_control.host.json",
            browser: "firefox"
          }
        ]
      : [
          {
            relativePath: ".config/google-chrome/NativeMessagingHosts/com.localhost_control.host.json",
            browser: "chrome"
          },
          {
            relativePath: ".config/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.localhost_control.host.json",
            browser: "brave"
          },
          {
            relativePath: ".mozilla/native-messaging-hosts/com.localhost_control.host.json",
            browser: "firefox"
          }
        ];

  for (const manifest of manifests) {
    await validateNativeManifestFile(homeDir, manifest.relativePath, manifest.browser, expectedHostPath);
  }
};

const validateTarball = async () => {
  const entries = run("tar", ["-tzf", artifact]).split(/\r?\n/).filter(Boolean);
  requireEntry(entries, "localhost-control-host");
  if ((platform === "linux" || platform === "darwin") && entries.some((entry) => normalizeEntry(entry).includes("app/native-host"))) {
    throw new Error(`${platform} tarball must package the Rust native host without the Node app payload.`);
  }
  requireEntry(entries, "install.sh");
  requireEntry(entries, "uninstall.sh");

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "localhost-control-tarball-"));
  try {
    const extractRoot = path.join(tempRoot, "package");
    await extractTarGz(await readFile(artifact), tempRoot, "package.tar.gz", extractRoot);
    await validateTarballInstall(extractRoot, tempRoot);
  } finally {
    await removeTempRoot(tempRoot);
  }
};

const validateDeb = async () => {
  const entries = extractArArchive(await readFile(artifact));
  const controlTar = entries.get("control.tar.gz");
  const dataTar = entries.get("data.tar.gz");
  const debianBinary = entries.get("debian-binary");
  if (!controlTar || !dataTar || !debianBinary) throw new Error("Debian package must contain debian-binary, control.tar.gz, and data.tar.gz.");
  if (debianBinary.toString() !== "2.0\n") throw new Error("Debian package has an unsupported debian-binary version.");

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "localhost-control-deb-"));
  try {
    const controlRoot = path.join(tempRoot, "control");
    await extractTarGz(controlTar, tempRoot, "control.tar.gz", controlRoot);
    const control = await readFile(path.join(controlRoot, "control"), "utf8");
    const postinst = await readFile(path.join(controlRoot, "postinst"), "utf8").catch(() => "");
    if (!control.includes("localhost-control-native-host")) throw new Error("Debian package metadata is missing the package name.");
    if (!control.includes(packageJson.version)) throw new Error("Debian package metadata is missing the project version.");
    if (control.includes("nodejs")) throw new Error("Debian package metadata must not depend on nodejs.");
    if (!postinst.includes("chmod 755 /usr/lib/localhost-control/localhost-control-host")) {
      throw new Error("Debian package postinst must restore the native host executable permission.");
    }

    const dataRoot = path.join(tempRoot, "data");
    const dataEntries = await listTarGzEntries(dataTar, tempRoot, "data.tar.gz");
    await extractTarGz(dataTar, tempRoot, "data.tar.gz", dataRoot);
    requireEntry(dataEntries, "usr/lib/localhost-control/localhost-control-host");
    if (dataEntries.some((entry) => normalizeEntry(entry).includes("usr/lib/localhost-control/app/native-host"))) {
      throw new Error("Debian package must package the Rust native host without the Node app payload.");
    }
    const chromeManifest = `etc/opt/chrome/native-messaging-hosts/${hostName}.json`;
    const braveManifest = `etc/brave/native-messaging-hosts/${hostName}.json`;
    const firefoxManifest = `usr/lib/mozilla/native-messaging-hosts/${hostName}.json`;
    requireEntry(dataEntries, chromeManifest);
    requireEntry(dataEntries, braveManifest);
    requireEntry(dataEntries, firefoxManifest);
    await validateNativeManifestFile(dataRoot, chromeManifest, "chrome");
    await validateNativeManifestFile(dataRoot, braveManifest, "brave");
    await validateNativeManifestFile(dataRoot, firefoxManifest, "firefox");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};

const validatePkg = async () => {
  const entries = run("pkgutil", ["--payload-files", artifact]).split(/\r?\n/).filter(Boolean);
  const hostEntry = "Library/Application Support/Localhost Control/localhost-control-host";
  const chromeManifest = `Library/Application Support/Google/Chrome/NativeMessagingHosts/${hostName}.json`;
  const braveManifest = `Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/${hostName}.json`;
  const firefoxManifest = `Library/Application Support/Mozilla/NativeMessagingHosts/${hostName}.json`;
  requireEntry(entries, hostEntry);
  if (entries.some((entry) => normalizeEntry(entry).includes("Library/Application Support/Localhost Control/app/native-host"))) {
    throw new Error("macOS pkg must package the Rust native host without the Node app payload.");
  }
  requireEntry(entries, chromeManifest);
  requireEntry(entries, braveManifest);
  requireEntry(entries, firefoxManifest);

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "localhost-control-pkg-"));
  try {
    const expandedRoot = path.join(tempRoot, "expanded");
    run("pkgutil", ["--expand-full", artifact, expandedRoot]);
    await validateNativeManifestBySuffix(expandedRoot, chromeManifest, "chrome", macosHostPath);
    await validateNativeManifestBySuffix(expandedRoot, braveManifest, "brave", macosHostPath);
    await validateNativeManifestBySuffix(expandedRoot, firefoxManifest, "firefox", macosHostPath);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};

const validateWindowsZip = async () => {
  if (process.platform !== "win32") {
    throw new Error("Windows zip validation must run on Windows.");
  }
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "localhost-control-winzip-"));
  try {
    run("powershell", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Expand-Archive -LiteralPath $env:LOCALHOST_CONTROL_ARTIFACT -DestinationPath $env:LOCALHOST_CONTROL_OUTPUT -Force"
    ], {
      LOCALHOST_CONTROL_ARTIFACT: artifact,
      LOCALHOST_CONTROL_OUTPUT: tempRoot
    });
    const entries = run("powershell", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Get-ChildItem -LiteralPath $env:LOCALHOST_CONTROL_OUTPUT -Recurse -File | ForEach-Object { $_.FullName.Substring($env:LOCALHOST_CONTROL_OUTPUT.Length + 1).Replace('\\\\', '/') }"
    ], {
      LOCALHOST_CONTROL_OUTPUT: tempRoot
    }).split(/\r?\n/).filter(Boolean);
    requireEntry(entries, "install.ps1");
    requireEntry(entries, "uninstall.ps1");
    requireEntry(entries, "out/localhost-control-host.exe");
    if (entries.some((entry) => normalizeEntry(entry).includes("app/native-host"))) {
      throw new Error("Windows zip must package the Rust native host without the Node app payload.");
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};

if ((platform === "linux" || platform === "darwin") && format === "tarball") await validateTarball();
else if (platform === "linux" && format === "deb") await validateDeb();
else if (platform === "darwin" && format === "pkg") await validatePkg();
else if (platform === "win32" && format === "zip") await validateWindowsZip();
else throw new Error(`Unsupported package target: ${platform}/${format}`);

console.log(`Validated ${artifact}`);
