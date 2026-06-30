#!/usr/bin/env node
import { inflateRawSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FIREFOX_EXTENSION_ID } from "./lib/extension-manifest.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootPackageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
const extensionPackageJson = JSON.parse(await readFile(path.join(repoRoot, "packages", "extension", "package.json"), "utf8"));
const sourceChromeManifest = JSON.parse(await readFile(path.join(repoRoot, "packages", "extension", "public", "manifest.json"), "utf8"));

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
if (target !== "chrome" && target !== "firefox") throw new Error(`Unsupported extension target: ${target}`);

const defaultOutputDir =
  target === "chrome" ? path.join(repoRoot, "dist", "chrome-store") : path.join(repoRoot, "dist", "firefox-addons");
const outputDir = path.resolve(args.get("out-dir") ?? defaultOutputDir);
const artifact = path.resolve(
  args.get("artifact") ??
    path.join(
      outputDir,
      `localhost-control-${rootPackageJson.version}-${target === "chrome" ? "chrome-store" : "firefox"}.zip`
    )
);

const normalizeEntry = (value) => value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");

const readZipEntries = async (zipPath) => {
  const buffer = await readFile(zipPath);
  const endSignature = 0x06054b50;
  let endOffset = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65_557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === endSignature) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset === -1) throw new Error("Extension package is not a valid ZIP archive.");

  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(endOffset + 16);
  const entries = new Map();
  let cursor = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Extension ZIP central directory is malformed.");
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const name = normalizeEntry(buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8"));

    if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error(`Extension ZIP local header is malformed for ${name}.`);
    }
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const data =
      method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : undefined;
    if (!data) throw new Error(`Unsupported ZIP compression method ${method} for ${name}.`);
    if (data.length !== uncompressedSize) throw new Error(`ZIP entry has invalid size: ${name}.`);
    entries.set(name, data);
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
};

const readJsonEntry = (entries, entryName) => {
  const entry = entries.get(entryName);
  if (!entry) throw new Error(`Missing package entry: ${entryName}`);
  try {
    return JSON.parse(entry.toString("utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON in ${entryName}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const requireEntry = (entries, entryName) => {
  if (!entries.has(entryName)) throw new Error(`Missing package entry: ${entryName}`);
};

const assertNoEntry = (entries, pattern, message) => {
  const match = [...entries.keys()].find((entry) => pattern.test(entry));
  if (match) throw new Error(`${message}: ${match}`);
};

const assertArrayEquals = (actual, expected, message) => {
  if (!Array.isArray(actual) || actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(message);
  }
};

const requireManifestIconEntries = (entries, manifest) => {
  for (const size of ["16", "32", "48", "128"]) {
    const iconPath = manifest.icons?.[size];
    const expectedPath = sourceChromeManifest.icons?.[size];
    if (iconPath !== expectedPath) throw new Error(`Manifest icon size ${size} must point at ${expectedPath}.`);
    requireEntry(entries, normalizeEntry(expectedPath));
  }
};

const requireIconMap = (actual, expected, message) => {
  for (const size of ["16", "32", "48", "128"]) {
    if (actual?.[size] !== expected?.[size]) throw new Error(`${message} icon size ${size} must point at ${expected?.[size]}.`);
  }
};

const requireHtmlAssetReferences = (entries) => {
  const html = entries.get("sidepanel.html")?.toString("utf8") ?? "";
  const references = [...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((value) => value && !/^[a-z]+:/i.test(value))
    .map((value) => normalizeEntry(value.split(/[?#]/)[0]));
  for (const reference of references) {
    requireEntry(entries, reference);
  }
};

const validateSharedManifest = (manifest) => {
  if (manifest.manifest_version !== 3) throw new Error("Extension manifest_version must be 3.");
  if (manifest.name !== "Localhost Control") throw new Error("Extension manifest name must be Localhost Control.");
  if (manifest.version !== extensionPackageJson.version || manifest.version !== rootPackageJson.version) {
    throw new Error("Extension manifest version must match package versions.");
  }
  assertArrayEquals(
    manifest.optional_host_permissions,
    sourceChromeManifest.optional_host_permissions,
    "Extension optional_host_permissions must stay localhost-only and match the source manifest."
  );
  if ("host_permissions" in manifest) throw new Error("Extension package must not request host_permissions.");
};

const validateChromeManifest = (manifest) => {
  if (manifest.side_panel?.default_path !== "sidepanel.html") throw new Error("Chrome package must include side_panel.default_path.");
  if (!manifest.action) throw new Error("Chrome package must include action.");
  requireIconMap(manifest.action.default_icon, sourceChromeManifest.action.default_icon, "Chrome action");
  if ("sidebar_action" in manifest) throw new Error("Chrome package must not include sidebar_action.");
  if (manifest.description !== sourceChromeManifest.description) throw new Error("Chrome package description is incorrect.");
  if (manifest.background?.service_worker !== "background.js") throw new Error("Chrome package must use background.service_worker.");
  if (manifest.background?.type !== "module") throw new Error("Chrome package must keep module background type.");
  if (manifest.browser_specific_settings?.gecko) throw new Error("Chrome package must not include Firefox gecko settings.");
  assertArrayEquals(manifest.permissions, ["nativeMessaging", "sidePanel", "storage", "browsingData", "notifications"], "Chrome permissions are incorrect.");
};

const validateFirefoxManifest = (manifest) => {
  if (manifest.description !== "Find and stop stale localhost development servers from a clean Firefox sidebar.") {
    throw new Error("Firefox package description is incorrect.");
  }
  if ("service_worker" in (manifest.background ?? {})) throw new Error("Firefox package must not include background.service_worker.");
  if ("type" in (manifest.background ?? {})) throw new Error("Firefox package must not include background.type.");
  assertArrayEquals(manifest.background?.scripts, ["background.js"], "Firefox package must use background.scripts.");
  if ("action" in manifest) throw new Error("Firefox package must not include action.");
  if ("side_panel" in manifest) throw new Error("Firefox package must not include side_panel.");
  if (manifest.sidebar_action?.default_panel !== "sidepanel.html") throw new Error("Firefox package must include sidebar_action.default_panel.");
  if (manifest.sidebar_action?.open_at_install !== false) throw new Error("Firefox sidebar must not open at install.");
  requireIconMap(manifest.sidebar_action?.default_icon, sourceChromeManifest.action.default_icon, "Firefox sidebar");
  if (manifest.browser_specific_settings?.gecko?.id !== FIREFOX_EXTENSION_ID) throw new Error("Firefox gecko id is incorrect.");
  assertArrayEquals(
    manifest.browser_specific_settings?.gecko?.data_collection_permissions?.required,
    ["none"],
    "Firefox data collection declaration is incorrect."
  );
  assertArrayEquals(manifest.permissions, ["nativeMessaging", "storage", "browsingData", "notifications"], "Firefox permissions are incorrect.");
};

const validatePackage = async () => {
  const entries = await readZipEntries(artifact);
  for (const entry of ["manifest.json", "background.js", "sidepanel.html", "sidepanel.js"]) requireEntry(entries, entry);
  if (![...entries.keys()].some((entry) => /^assets\/[^/]+\.css$/.test(entry))) {
    throw new Error("Extension package must include a built CSS asset.");
  }
  assertNoEntry(entries, /(^|\/)(node_modules|src|installer|native-host)(\/|$)/, "Extension package contains development-only directory");
  assertNoEntry(entries, /(^|\/)(package\.json|vite\.config\.[cm]?[jt]s|tsconfig[^/]*\.json)$/i, "Extension package contains development config");
  assertNoEntry(entries, /\.(map|ts|tsx|test\.[cm]?[jt]sx?)$/i, "Extension package contains development source or sourcemap");

  const manifest = readJsonEntry(entries, "manifest.json");
  validateSharedManifest(manifest);
  requireManifestIconEntries(entries, manifest);
  requireHtmlAssetReferences(entries);
  if (target === "chrome") validateChromeManifest(manifest);
  else validateFirefoxManifest(manifest);
  console.log(`Validated ${artifact}`);
};

await validatePackage();
