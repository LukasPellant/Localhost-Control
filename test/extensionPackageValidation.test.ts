import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildFirefoxManifest } from "../scripts/lib/extension-manifest.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageVersion = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")).version as string;
const expectedIconMap = {
  "16": "icons/localhost-control-ghost-16.png",
  "32": "icons/localhost-control-ghost-32.png",
  "48": "icons/localhost-control-ghost-48.png",
  "128": "icons/localhost-control-ghost-128.png"
};

const writeUInt16 = (value: number) => {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
};

const writeUInt32 = (value: number) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
};

const writeZip = (output: string, entries: Record<string, string | Buffer>) => {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const [name, value] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name);
    const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const localHeader = Buffer.concat([
      writeUInt32(0x04034b50),
      writeUInt16(20),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt32(0),
      writeUInt32(data.length),
      writeUInt32(data.length),
      writeUInt16(nameBuffer.length),
      writeUInt16(0),
      nameBuffer
    ]);
    localParts.push(localHeader, data);

    centralParts.push(
      Buffer.concat([
        writeUInt32(0x02014b50),
        writeUInt16(20),
        writeUInt16(20),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt32(0),
        writeUInt32(data.length),
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
    offset += localHeader.length + data.length;
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

  writeFileSync(output, Buffer.concat([...localParts, centralDirectory, endRecord]));
};

const chromeManifest = () => ({
  manifest_version: 3,
  name: "Localhost Control",
  version: packageVersion,
  description: "Find and kill stale localhost development servers from a clean Chromium side panel.",
  action: {
    default_title: "Localhost Control",
    default_icon: expectedIconMap
  },
  icons: expectedIconMap,
  background: {
    service_worker: "background.js",
    type: "module"
  },
  side_panel: {
    default_path: "sidepanel.html"
  },
  permissions: ["nativeMessaging", "sidePanel", "storage", "browsingData", "notifications"],
  optional_host_permissions: [
    "http://localhost/*",
    "http://127.0.0.1/*",
    "http://[::1]/*",
    "http://0.0.0.0/*",
    "http://*.localhost/*",
    "https://localhost/*",
    "https://127.0.0.1/*",
    "https://[::1]/*",
    "https://0.0.0.0/*",
    "https://*.localhost/*"
  ]
});

const packageEntries = (manifest: object): Record<string, string | Buffer> => ({
  "manifest.json": `${JSON.stringify(manifest, null, 2)}\n`,
  "sidepanel.html": '<!doctype html><link rel="stylesheet" href="/assets/sidepanel.css"><script type="module" src="/sidepanel.js"></script>',
  "background.js": "chrome.runtime.onInstalled.addListener(() => undefined);\n",
  "sidepanel.js": "console.log('Localhost Control');\n",
  "assets/sidepanel.css": "body { margin: 0; }\n",
  "icons/localhost-control-ghost-16.png": Buffer.from("icon16"),
  "icons/localhost-control-ghost-32.png": Buffer.from("icon32"),
  "icons/localhost-control-ghost-48.png": Buffer.from("icon48"),
  "icons/localhost-control-ghost-128.png": Buffer.from("icon128")
});

const runValidator = (target: "chrome" | "firefox", artifact: string) =>
  spawnSync(process.execPath, [
    path.join(repoRoot, "scripts", "validate-extension-package.mjs"),
    `--target=${target}`,
    `--artifact=${artifact}`
  ], { encoding: "utf8" });

describe("validate-extension-package", () => {
  it.each(["chrome", "firefox"] as const)("accepts a valid %s extension zip", (target) => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "localhost-control-extension-"));
    mkdirSync(tempRoot, { recursive: true });
    const artifact = path.join(tempRoot, `${target}.zip`);
    const manifest = target === "firefox" ? buildFirefoxManifest(chromeManifest()) : chromeManifest();
    writeZip(artifact, packageEntries(manifest));

    const result = runValidator(target, artifact);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Validated");
    expect(result.stderr).toBe("");
  });

  it("rejects a Chrome package that contains a Firefox sidebar manifest", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "localhost-control-extension-"));
    const artifact = path.join(tempRoot, "chrome-with-firefox-manifest.zip");
    writeZip(artifact, packageEntries(buildFirefoxManifest(chromeManifest())));

    const result = runValidator("chrome", artifact);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Chrome package must include side_panel.default_path.");
  });

  it("rejects Firefox packages with Chrome-only background keys even when they are empty", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "localhost-control-extension-"));
    const artifact = path.join(tempRoot, "firefox-with-empty-chrome-background-keys.zip");
    const manifest = buildFirefoxManifest(chromeManifest());
    manifest.background = { scripts: ["background.js"], service_worker: "", type: "" };
    writeZip(artifact, packageEntries(manifest));

    const result = runValidator("firefox", artifact);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Firefox package must not include background.service_worker.");
  });

  it("rejects manifests that point icons at non-icon package entries", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "localhost-control-extension-"));
    const artifact = path.join(tempRoot, "chrome-with-script-icons.zip");
    const manifest = chromeManifest();
    manifest.icons = { ...expectedIconMap, "16": "background.js" };
    manifest.action.default_icon = manifest.icons;
    writeZip(artifact, packageEntries(manifest));

    const result = runValidator("chrome", artifact);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Manifest icon size 16 must point at icons/localhost-control-ghost-16.png.");
  });

  it("rejects empty development-only directories", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "localhost-control-extension-"));
    const artifact = path.join(tempRoot, "chrome-with-empty-src-dir.zip");
    writeZip(artifact, { ...packageEntries(chromeManifest()), "src/": "" });

    const result = runValidator("chrome", artifact);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Extension package contains development-only directory: src/");
  });
});
