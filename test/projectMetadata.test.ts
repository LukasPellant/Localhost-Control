import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type PackageJson = {
  description?: string;
  version?: string;
};

type ExtensionManifest = {
  description?: string;
  version?: string;
};

const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(__dirname, "..", path), "utf8")) as T;

const expectedProductDescription = "Find, check, clean, and stop localhost development servers from a clean browser side panel.";

describe("project metadata", () => {
  it("keeps release versions aligned across package and extension manifests", () => {
    const rootPackage = readJson<PackageJson>("package.json");
    const extensionPackage = readJson<PackageJson>("packages/extension/package.json");
    const extensionManifest = readJson<ExtensionManifest>("packages/extension/public/manifest.json");

    expect(extensionPackage.version).toBe(rootPackage.version);
    expect(extensionManifest.version).toBe(rootPackage.version);
  });

  it("keeps package descriptions aligned with the command-center product scope", () => {
    const rootPackage = readJson<PackageJson>("package.json");
    const extensionManifest = readJson<ExtensionManifest>("packages/extension/public/manifest.json");

    expect(rootPackage.description).toBe(expectedProductDescription);
    expect(extensionManifest.description).toContain("Find, check, clean, and stop localhost development servers");
  });
});
