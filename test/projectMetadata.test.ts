import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type PackageJson = {
  description?: string;
  devDependencies?: Record<string, string>;
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

  it("keeps current release notes aligned with native host artifact names and macOS signing caveats", () => {
    const rootPackage = readJson<PackageJson>("package.json");
    const version = rootPackage.version;
    const releaseNotes = readFileSync(resolve(__dirname, "..", `docs/releases/v${version}.md`), "utf8");

    expect(releaseNotes).toContain(`localhost-control-native-host-windows-${version}.zip`);
    expect(releaseNotes).toContain(`localhost-control-native-host-macos-universal-${version}.pkg`);
    expect(releaseNotes).toContain(`localhost-control-native-host-macos-universal-${version}.tar.gz`);
    expect(releaseNotes).toContain(`localhost-control-native-host_${version}_amd64.deb`);
    expect(releaseNotes).toContain(`localhost-control-native-host_${version}_arm64.deb`);
    expect(releaseNotes).toContain("notarized");
    expect(releaseNotes).toContain("Gatekeeper");
  });

  it("keeps Firefox release lint pinned to the lockfile", () => {
    const rootPackage = readJson<PackageJson>("package.json");
    const firefoxLintScript = readFileSync(resolve(__dirname, "..", "scripts/lint-firefox-extension.mjs"), "utf8");

    expect(rootPackage.devDependencies?.["web-ext"]).toBe("10.4.0");
    expect(firefoxLintScript).not.toContain("web-ext@latest");
    expect(firefoxLintScript).not.toContain("npx");
  });

  it("keeps store submission notes tied to final release artifacts and browser-native messaging checks", () => {
    const storeNotes = readFileSync(resolve(__dirname, "..", "docs/chrome-store-submission.md"), "utf8");

    expect(storeNotes).toContain("release-native-host.yml");
    expect(storeNotes).toContain("GitHub Release");
    expect(storeNotes).toContain("SHA256SUMS");
    expect(storeNotes).toContain("Firefox native messaging");
    expect(storeNotes).toContain("Chrome, Brave, and Firefox");
    expect(storeNotes).toContain("macOS signing/notarization");
  });
});
