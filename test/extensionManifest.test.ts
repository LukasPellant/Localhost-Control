import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildFirefoxManifest, FIREFOX_EXTENSION_ID } from "../scripts/lib/extension-manifest.mjs";

const readChromeManifest = () =>
  JSON.parse(readFileSync(resolve(__dirname, "../packages/extension/public/manifest.json"), "utf8"));

describe("buildFirefoxManifest", () => {
  it("converts the Chrome side panel manifest to a Firefox sidebar manifest", () => {
    const manifest = buildFirefoxManifest(readChromeManifest());

    expect(manifest.permissions).toEqual(["nativeMessaging", "storage", "browsingData"]);
    expect(manifest).not.toHaveProperty("side_panel");
    expect(manifest).not.toHaveProperty("action");
    expect(manifest).toMatchObject({
      background: {
        scripts: ["background.js"]
      },
      sidebar_action: {
        default_panel: "sidepanel.html",
        default_title: "Localhost Control"
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
});
