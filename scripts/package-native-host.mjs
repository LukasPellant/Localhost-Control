#!/usr/bin/env node
import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { buildNativeHostManifest, DEFAULT_EXTENSION_ID, resolveNativeMessagingManifestTargets } from "../packages/native-host/dist/nativeHostManifest.js";

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

const stageNodeHostApp = async (stageDir) => {
  const appRoot = path.join(stageDir, "app", "native-host");
  await mkdir(appRoot, { recursive: true });
  await cp(path.join(repoRoot, "packages", "native-host", "dist"), path.join(appRoot, "dist"), { recursive: true });
  await cp(path.join(repoRoot, "packages", "native-host", "package.json"), path.join(appRoot, "package.json"));
  await cp(path.join(repoRoot, "packages", "shared", "dist"), path.join(appRoot, "node_modules", "@localhost-control", "shared", "dist"), {
    recursive: true
  });
  await cp(path.join(repoRoot, "packages", "shared", "package.json"), path.join(appRoot, "node_modules", "@localhost-control", "shared", "package.json"));
  await writeFile(
    path.join(stageDir, "localhost-control-host"),
    [
      "#!/usr/bin/env sh",
      "set -eu",
      'DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"',
      'exec node "$DIR/app/native-host/dist/index.js"',
      ""
    ].join("\n")
  );
  await chmod(path.join(stageDir, "localhost-control-host"), 0o755);
};

const stagePath = (rootDir, targetPath) => (rootDir ? path.join(rootDir, targetPath.replace(/^[/\\]+/, "")) : targetPath);

const writeManifestTargets = async ({ platform, scope, rootDir, hostPath, extensionId }) => {
  const manifest = buildNativeHostManifest({ hostPath, extensionId });
  const targets = resolveNativeMessagingManifestTargets(platform, scope);
  for (const target of targets) {
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

const packageDeb = async ({ stageDir, outputDir, version, arch }) => {
  const dataRoot = path.join(stageDir, "deb-data");
  const controlRoot = path.join(stageDir, "deb-control");
  const installRoot = path.join(dataRoot, "usr", "lib", "localhost-control");
  await mkdir(controlRoot, { recursive: true });
  await mkdir(installRoot, { recursive: true });
  await cp(path.join(stageDir, "localhost-control-host"), path.join(installRoot, "localhost-control-host"));
  if (await pathExists(path.join(stageDir, "app"))) {
    await cp(path.join(stageDir, "app"), path.join(installRoot, "app"), { recursive: true });
  }
  await chmod(path.join(installRoot, "localhost-control-host"), 0o755);
  await writeManifestTargets({
    platform: "linux",
    scope: "system",
    rootDir: dataRoot,
    hostPath: "/usr/lib/localhost-control/localhost-control-host",
    extensionId: DEFAULT_EXTENSION_ID
  });
  await writeFile(
    path.join(controlRoot, "control"),
    [
      "Package: localhost-control-native-host",
      `Version: ${version}`,
      "Section: utils",
      "Priority: optional",
      `Architecture: ${arch}`,
      "Depends: nodejs (>= 18)",
      "Maintainer: Localhost Control <support@localhost-control.local>",
      "Description: Native messaging host for the Localhost Control browser extension",
      ""
    ].join("\n")
  );

  const output = path.join(outputDir, `localhost-control-native-host_${version}_${arch}.deb`);
  const controlTar = path.join(stageDir, "control.tar.gz");
  const dataTar = path.join(stageDir, "data.tar.gz");
  for (const [source, destination] of [
    [controlRoot, controlTar],
    [dataRoot, dataTar]
  ]) {
    const result = spawnSync("tar", ["-czf", destination, "-C", source, "."], { stdio: "inherit" });
    if (result.status !== 0) throw new Error(`tar packaging failed for ${destination}`);
  }
  await writeArArchive(output, [
    { name: "debian-binary", data: Buffer.from("2.0\n") },
    { name: "control.tar.gz", data: controlTar },
    { name: "data.tar.gz", data: dataTar }
  ]);
  return output;
};

const packagePkg = async ({ stageDir, outputDir, version }) => {
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
    extensionId: DEFAULT_EXTENSION_ID
  });

  const output = path.join(outputDir, `localhost-control-native-host-${version}.pkg`);
  const result = spawnSync("pkgbuild", ["--root", pkgRoot, "--identifier", "com.localhost-control.native-host", "--version", version, output], { stdio: "inherit" });
  if (result.status !== 0) throw new Error("pkgbuild packaging failed");
  return output;
};

const main = async () => {
  const args = parseArgs();
  const platform = args.get("platform") ?? process.platform;
  const format = args.get("format") ?? (platform === "darwin" ? "pkg" : "tarball");
  const arch = args.get("arch") ?? (process.arch === "arm64" ? "arm64" : "amd64");
  const extensionId = args.get("extension-id") ?? DEFAULT_EXTENSION_ID;
  const hostBinary = args.get("host-binary") ? path.resolve(args.get("host-binary")) : undefined;
  const outputDir = path.resolve(args.get("out-dir") ?? path.join(repoRoot, "dist", "native-host"));
  const stageDir = path.join(os.tmpdir(), `localhost-control-native-host-${platform}-${Date.now()}`);

  await rm(stageDir, { recursive: true, force: true });
  await mkdir(stageDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  const hostName = platform === "win32" ? "localhost-control-host.exe" : "localhost-control-host";
  if (hostBinary) {
    await copyHostBinary(hostBinary, path.join(stageDir, hostName));
  } else {
    await stageNodeHostApp(stageDir);
  }

  let output;
  if (platform === "darwin" && format === "pkg") output = await packagePkg({ stageDir, outputDir, version: packageJson.version });
  else if (platform === "darwin" && format === "tarball") output = await packageTarball({ platform, stageDir, outputDir, version: packageJson.version });
  else if (platform === "linux" && format === "deb") output = await packageDeb({ stageDir, outputDir, version: packageJson.version, arch });
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
