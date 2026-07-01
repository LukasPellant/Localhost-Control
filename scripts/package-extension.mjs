#!/usr/bin/env node
import { deflateRawSync } from "node:zlib";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseArgs } from "./lib/cli-args.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = parseArgs();
const target = args.get("target") ?? "chrome";
if (target !== "chrome" && target !== "firefox") throw new Error(`Unsupported extension target: ${target}`);

const extensionDir = path.join(repoRoot, "packages", "extension");
const distDir = path.join(extensionDir, "dist");
const packageLockDir = path.join(os.tmpdir(), "localhost-control-extension-package.lock");
const packageDir = path.resolve(
  args.get("out-dir") ?? path.join(repoRoot, "dist", target === "chrome" ? "chrome-store" : "firefox-addons")
);

const run = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32" && command.endsWith(".cmd"),
    ...options
  });
  if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(" ")} failed`);
};

const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const acquirePackageLock = async () => {
  const timeoutMs = 10 * 60 * 1000;
  const staleMs = 10 * 60 * 1000;
  const startedAt = Date.now();
  for (;;) {
    try {
      await mkdir(packageLockDir);
      return async () => rm(packageLockDir, { recursive: true, force: true });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const ageMs = Date.now() - (await stat(packageLockDir).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs;
      if (ageMs > staleMs) {
        await rm(packageLockDir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error("Timed out waiting for the Localhost Control extension package lock.");
      }
      await sleep(250);
    }
  }
};

const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

const crc32 = (buffer) => {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
};

const writeUInt16 = (value) => {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
};

const writeUInt32 = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
};

const listFiles = async (root, relative = "") => {
  const items = await readdir(path.join(root, relative), { withFileTypes: true });
  const files = [];
  for (const item of items.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = path.posix.join(relative.replace(/\\/g, "/"), item.name);
    if (item.isDirectory()) files.push(...(await listFiles(root, relativePath)));
    else if (item.isFile()) files.push(relativePath);
  }
  return files;
};

const writeZip = async (root, output) => {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const name of await listFiles(root)) {
    const data = await readFile(path.join(root, ...name.split("/")));
    const compressed = deflateRawSync(data, { level: 9 });
    const nameBuffer = Buffer.from(name);
    const crc = crc32(data);
    const localHeader = Buffer.concat([
      writeUInt32(0x04034b50),
      writeUInt16(20),
      writeUInt16(0),
      writeUInt16(8),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt32(crc),
      writeUInt32(compressed.length),
      writeUInt32(data.length),
      writeUInt16(nameBuffer.length),
      writeUInt16(0),
      nameBuffer
    ]);
    localParts.push(localHeader, compressed);

    centralParts.push(
      Buffer.concat([
        writeUInt32(0x02014b50),
        writeUInt16(20),
        writeUInt16(20),
        writeUInt16(0),
        writeUInt16(8),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt32(crc),
        writeUInt32(compressed.length),
        writeUInt32(data.length),
        writeUInt16(nameBuffer.length),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt32(0),
        writeUInt32(offset),
        nameBuffer
      ])
    );
    offset += localHeader.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.concat([
    writeUInt32(0x06054b50),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(centralParts.length),
    writeUInt16(centralParts.length),
    writeUInt32(centralDirectory.length),
    writeUInt32(offset),
    writeUInt16(0)
  ]);

  await writeFile(output, Buffer.concat([...localParts, centralDirectory, endRecord]));
};

const main = async () => {
  const releasePackageLock = await acquirePackageLock();

  const stageDir = await mkdtemp(path.join(os.tmpdir(), `localhost-control-extension-${target}-`));
  try {
    run(pnpmCommand, ["--filter", "@localhost-control/extension", "build"]);

    await mkdir(stageDir, { recursive: true });
    await cp(distDir, stageDir, { recursive: true });

    const manifestPath = path.join(stageDir, "manifest.json");
    await stat(manifestPath);
    run(process.execPath, [
      path.join(repoRoot, "scripts", "prepare-extension-target.mjs"),
      `--target=${target}`,
      `--dist-dir=${stageDir}`
    ]);

    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const version = manifest.version;
    if (!version) throw new Error(`Unable to read extension version from ${manifestPath}`);

    await mkdir(packageDir, { recursive: true });
    for (const file of await readdir(packageDir)) {
      if (/^localhost-control-.*\.zip$/.test(file)) {
        await rm(path.join(packageDir, file), { force: true });
      }
    }

    const zipSuffix = target === "chrome" ? "chrome-store" : "firefox";
    const zipPath = path.join(packageDir, `localhost-control-${version}-${zipSuffix}.zip`);
    await writeZip(stageDir, zipPath);
    run(process.execPath, [
      path.join(repoRoot, "scripts", "validate-extension-package.mjs"),
      `--target=${target}`,
      `--artifact=${zipPath}`
    ]);

    console.log(`${target} extension package created:`);
    console.log(zipPath);
  } finally {
    await rm(stageDir, { recursive: true, force: true });
    await releasePackageLock();
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
