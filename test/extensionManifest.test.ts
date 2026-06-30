import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildFirefoxManifest, FIREFOX_EXTENSION_ID } from "../scripts/lib/extension-manifest.mjs";

const readChromeManifest = () =>
  JSON.parse(readFileSync(resolve(__dirname, "../packages/extension/public/manifest.json"), "utf8"));

const prepareManifest = (target: "chrome" | "firefox") => {
  const distDir = mkdtempSync(resolve(tmpdir(), `localhost-control-${target}-`));
  try {
    writeFileSync(resolve(distDir, "manifest.json"), `${JSON.stringify(readChromeManifest(), null, 2)}\n`);
    execFileSync(process.execPath, [
      resolve(__dirname, "../scripts/prepare-extension-target.mjs"),
      `--target=${target}`,
      `--dist-dir=${distDir}`
    ]);
    return JSON.parse(readFileSync(resolve(distDir, "manifest.json"), "utf8"));
  } finally {
    rmSync(distDir, { force: true, recursive: true });
  }
};

describe("buildFirefoxManifest", () => {
  it("converts the Chrome side panel manifest to a Firefox sidebar manifest", () => {
    const manifest = buildFirefoxManifest(readChromeManifest());

    expect(manifest.permissions).toEqual(["nativeMessaging", "storage", "browsingData", "notifications"]);
    expect(manifest.optional_host_permissions).toContain("http://localhost/*");
    expect(manifest.optional_host_permissions).toContain("https://*.localhost/*");
    expect(manifest).not.toHaveProperty("side_panel");
    expect(manifest).not.toHaveProperty("action");
    expect(manifest).toMatchObject({
      background: {
        scripts: ["background.js"]
      },
      sidebar_action: {
        default_panel: "sidepanel.html",
        default_title: "Localhost Control",
        open_at_install: false
      },
      browser_specific_settings: {
        gecko: {
          id: FIREFOX_EXTENSION_ID,
          data_collection_permissions: {
            required: ["none"]
          }
        }
      }
    });
  });

  it("writes the Firefox first-run sidebar preference when preparing a package target", () => {
    const manifest = prepareManifest("firefox");

    expect(manifest.sidebar_action).toMatchObject({
      default_panel: "sidepanel.html",
      default_title: "Localhost Control",
      open_at_install: false
    });
  });

  it("leaves the Chrome package target manifest unchanged", () => {
    const manifest = prepareManifest("chrome");

    expect(manifest).toHaveProperty("action");
    expect(manifest).toHaveProperty("side_panel");
    expect(manifest).not.toHaveProperty("sidebar_action");
  });
});
