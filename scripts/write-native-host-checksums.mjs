#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./lib/cli-args.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
const args = parseArgs();
const outputDir = path.resolve(args.get("out-dir") ?? path.join(repoRoot, "dist", "native-host"));
const version = args.get("version") ?? packageJson.version;
const files = (await readdir(outputDir))
  .filter((file) => /\.(deb|pkg|tar\.gz|zip)$/.test(file))
  .filter((file) => args.get("all") === "true" || file.includes(version))
  .sort((a, b) => a.localeCompare(b));

if (files.length === 0) {
  throw new Error(`No native host artifacts for version ${version} found in ${outputDir}`);
}

const lines = [];
for (const file of files) {
  const bytes = await readFile(path.join(outputDir, file));
  const hash = createHash("sha256").update(bytes).digest("hex");
  lines.push(`${hash}  ${file}`);
}

const checksumPath = path.join(outputDir, "SHA256SUMS");
await writeFile(checksumPath, `${lines.join("\n")}\n`);
console.log(checksumPath);
