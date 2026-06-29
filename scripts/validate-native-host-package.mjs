#!/usr/bin/env node
import { readFile } from "node:fs/promises";
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

const normalizeEntry = (entry) => entry.trim().replace(/\\/g, "/").replace(/^\.\//, "");

const requireEntry = (entries, expectedSuffix) => {
  if (!entries.some((entry) => normalizeEntry(entry).endsWith(expectedSuffix))) {
    throw new Error(`Missing package entry: ${expectedSuffix}`);
  }
};

const validateTarball = () => {
  const entries = run("tar", ["-tzf", artifact]).split(/\r?\n/).filter(Boolean);
  requireEntry(entries, "localhost-control-host");
  requireEntry(entries, "app/native-host/dist/index.js");
  requireEntry(entries, "app/native-host/package.json");
  requireEntry(entries, "app/native-host/node_modules/@localhost-control/shared/dist/index.js");
  requireEntry(entries, "install.sh");
  requireEntry(entries, "uninstall.sh");
};

const validateDeb = () => {
  const control = run("dpkg-deb", ["-f", artifact, "Package", "Version", "Architecture", "Depends"]);
  if (!control.includes("localhost-control-native-host")) throw new Error("Debian package metadata is missing the package name.");
  if (!control.includes(packageJson.version)) throw new Error("Debian package metadata is missing the project version.");
  if (!control.includes("nodejs")) throw new Error("Debian package metadata must depend on nodejs.");

  const entries = run("dpkg-deb", ["-c", artifact]).split(/\r?\n/).filter(Boolean);
  requireEntry(entries, "usr/lib/localhost-control/localhost-control-host");
  requireEntry(entries, "usr/lib/localhost-control/app/native-host/dist/index.js");
  requireEntry(entries, `etc/opt/chrome/native-messaging-hosts/${hostName}.json`);
  requireEntry(entries, `etc/brave/native-messaging-hosts/${hostName}.json`);
};

const validatePkg = () => {
  const entries = run("pkgutil", ["--payload-files", artifact]).split(/\r?\n/).filter(Boolean);
  requireEntry(entries, "Library/Application Support/Localhost Control/localhost-control-host");
  requireEntry(entries, "Library/Application Support/Localhost Control/app/native-host/dist/index.js");
  requireEntry(entries, `Library/Application Support/Google/Chrome/NativeMessagingHosts/${hostName}.json`);
  requireEntry(entries, `Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/${hostName}.json`);
};

if (platform === "linux" && format === "tarball") validateTarball();
else if (platform === "linux" && format === "deb") validateDeb();
else if (platform === "darwin" && format === "pkg") validatePkg();
else throw new Error(`Unsupported package target: ${platform}/${format}`);

console.log(`Validated ${artifact}`);
