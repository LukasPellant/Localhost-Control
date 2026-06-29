#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
const hostName = "com.localhost_control.host";

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
const format = args.get("format") ?? (platform === "darwin" ? "pkg" : "tarball");
const arch = args.get("arch") ?? (process.arch === "arm64" ? "arm64" : "amd64");
const outputDir = path.resolve(args.get("out-dir") ?? path.join(repoRoot, "dist", "native-host"));

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
  if (platform === "linux" && format === "deb") {
    return path.join(outputDir, `localhost-control-native-host_${packageJson.version}_${arch}.deb`);
  }
  throw new Error(`Unsupported package target: ${platform}/${format}`);
};

const artifact = path.resolve(args.get("artifact") ?? defaultArtifactPath());

const run = (command, commandArgs) => {
  const result = spawnSync(command, commandArgs, { encoding: "utf8" });
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${command} ${commandArgs.join(" ")} failed${details ? `\n${details}` : ""}`);
  }
  return result.stdout;
};

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

const normalizeEntry = (entry) => entry.trim().replace(/\\/g, "/").replace(/^\.\//, "");

const requireEntry = (entries, expectedSuffix) => {
  if (!entries.some((entry) => normalizeEntry(entry).endsWith(expectedSuffix))) {
    throw new Error(`Missing package entry: ${expectedSuffix}`);
  }
};

const validateTarball = () => {
  const entries = run("tar", ["-tzf", artifact]).split(/\r?\n/).filter(Boolean);
  requireEntry(entries, "localhost-control-host");
  if (platform === "darwin") {
    requireEntry(entries, "app/native-host/dist/index.js");
    requireEntry(entries, "app/native-host/package.json");
    requireEntry(entries, "app/native-host/node_modules/@localhost-control/shared/dist/index.js");
  }
  if (platform === "linux" && entries.some((entry) => normalizeEntry(entry).includes("app/native-host"))) {
    throw new Error("Linux tarball must package the Rust native host without the Node app payload.");
  }
  requireEntry(entries, "install.sh");
  requireEntry(entries, "uninstall.sh");
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

    const dataEntries = await listTarGzEntries(dataTar, tempRoot, "data.tar.gz");
    requireEntry(dataEntries, "usr/lib/localhost-control/localhost-control-host");
    if (dataEntries.some((entry) => normalizeEntry(entry).includes("usr/lib/localhost-control/app/native-host"))) {
      throw new Error("Debian package must package the Rust native host without the Node app payload.");
    }
    requireEntry(dataEntries, `etc/opt/chrome/native-messaging-hosts/${hostName}.json`);
    requireEntry(dataEntries, `etc/brave/native-messaging-hosts/${hostName}.json`);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};

const validatePkg = () => {
  const entries = run("pkgutil", ["--payload-files", artifact]).split(/\r?\n/).filter(Boolean);
  requireEntry(entries, "Library/Application Support/Localhost Control/localhost-control-host");
  requireEntry(entries, "Library/Application Support/Localhost Control/app/native-host/dist/index.js");
  requireEntry(entries, `Library/Application Support/Google/Chrome/NativeMessagingHosts/${hostName}.json`);
  requireEntry(entries, `Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/${hostName}.json`);
};

if ((platform === "linux" || platform === "darwin") && format === "tarball") validateTarball();
else if (platform === "linux" && format === "deb") await validateDeb();
else if (platform === "darwin" && format === "pkg") validatePkg();
else throw new Error(`Unsupported package target: ${platform}/${format}`);

console.log(`Validated ${artifact}`);
