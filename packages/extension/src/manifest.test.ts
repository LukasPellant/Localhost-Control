import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type ExtensionManifest = {
  version?: string;
  permissions?: string[];
  host_permissions?: string[];
  optional_host_permissions?: string[];
};

type PackageJson = {
  version?: string;
};

const readManifest = (): ExtensionManifest =>
  JSON.parse(readFileSync(resolve(__dirname, "../public/manifest.json"), "utf8")) as ExtensionManifest;

const readPackageJson = (): PackageJson =>
  JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as PackageJson;

describe("extension manifest", () => {
  it("uses the same version as the extension package", () => {
    expect(readManifest().version).toBe(readPackageJson().version);
  });

  it("requests only the browser permissions needed for native messaging, cleanup, and the side panel", () => {
    expect(readManifest().permissions).toEqual(["nativeMessaging", "sidePanel", "storage", "browsingData"]);
  });

  it("limits health-check host access to localhost origins", () => {
    const manifest = readManifest();
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.optional_host_permissions).toEqual([
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
    ]);
  });
});
