import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type ExtensionManifest = {
  version?: string;
  permissions?: string[];
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

  it("requests only the browser permissions needed for native messaging and the side panel", () => {
    expect(readManifest().permissions).toEqual(["nativeMessaging", "sidePanel", "storage"]);
  });
});
