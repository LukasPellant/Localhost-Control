#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFirefoxManifest } from "./lib/extension-manifest.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const parseArgs = () => {
  const args = new Map();
  for (const arg of process.argv.slice(2)) {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    args.set(key, value);
  }
  return args;
};

const args = parseArgs();
const target = args.get("target") ?? "chrome";
const distDir = path.resolve(args.get("dist-dir") ?? path.join(repoRoot, "packages", "extension", "dist"));
const manifestPath = path.join(distDir, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

if (target === "firefox") {
  await writeFile(manifestPath, `${JSON.stringify(buildFirefoxManifest(manifest), null, 2)}\n`);
} else if (target !== "chrome") {
  throw new Error(`Unsupported extension target: ${target}`);
}
