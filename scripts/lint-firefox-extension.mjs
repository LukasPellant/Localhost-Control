#!/usr/bin/env node
import { inflateRawSync } from "node:zlib";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));

const parseArgs = () => {
  const args = new Map();
  for (const arg of process.argv.slice(2)) {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    args.set(key, value);
  }
  return args;
};

const args = parseArgs();
const artifact = path.resolve(
  args.get("artifact") ??
    path.join(repoRoot, "dist", "firefox-addons", `localhost-control-${packageJson.version}-firefox.zip`)
);
const allowedWarningCodes = new Set(["UNSAFE_VAR_ASSIGNMENT"]);
const ignoredSummaryCodes = new Set(["ERRORS", "NOTICES", "WARNINGS"]);

const normalizeEntry = (value) => value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");

const extractZip = async (zipPath, outputDir) => {
  const buffer = await readFile(zipPath);
  let endOffset = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65_557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset === -1) throw new Error("Firefox package is not a valid ZIP archive.");

  const entryCount = buffer.readUInt16LE(endOffset + 10);
  let cursor = buffer.readUInt32LE(endOffset + 16);
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Firefox ZIP central directory is malformed.");
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const name = normalizeEntry(buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8"));
    cursor += 46 + nameLength + extraLength + commentLength;
    if (!name || name.endsWith("/")) continue;
    if (name.split("/").some((part) => part === "..")) throw new Error(`Unsafe ZIP entry path: ${name}`);

    if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error(`Firefox ZIP local header is malformed for ${name}.`);
    }
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : undefined;
    if (!data) throw new Error(`Unsupported ZIP compression method ${method} for ${name}.`);

    const outputPath = path.join(outputDir, ...name.split("/"));
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, data);
  }
};

const unexpectedWarningCodes = (output) =>
  [...new Set(output.match(/\b[A-Z][A-Z0-9_]{2,}\b/g) ?? [])].filter((code) => !allowedWarningCodes.has(code) && !ignoredSummaryCodes.has(code));

const main = async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "localhost-control-firefox-lint-"));
  try {
    await extractZip(artifact, tempRoot);
    const npx = process.platform === "win32" ? "npx.cmd" : "npx";
    const result = spawnSync(npx, ["--yes", "web-ext@latest", "lint", "--source-dir", tempRoot], {
      cwd: repoRoot,
      encoding: "utf8",
      shell: process.platform === "win32"
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.status !== 0) throw new Error("web-ext lint failed for the Firefox extension package");
    const unexpectedWarnings = unexpectedWarningCodes(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
    if (unexpectedWarnings.length) {
      throw new Error(`Unexpected Firefox lint warning: ${unexpectedWarnings.join(", ")}`);
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
