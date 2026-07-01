import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(resolve(__dirname, "../.github/workflows/release-native-host.yml"), "utf8");
const artifactWorkflow = readFileSync(resolve(__dirname, "../.github/workflows/native-host-artifacts.yml"), "utf8");
const packageJson = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

describe("release-native-host workflow", () => {
  it("checks out the requested release tag for manual dispatch builds", () => {
    const checkoutCount = (workflow.match(/uses: actions\/checkout@v4/g) ?? []).length;
    const pinnedRefCount = (workflow.match(/ref: \$\{\{ inputs\.tag \|\| github\.ref \}\}/g) ?? []).length;

    expect(checkoutCount).toBe(6);
    expect(pinnedRefCount).toBe(checkoutCount);
  });

  it("publishes Windows native host assets with the release", () => {
    expect(workflow).toContain("name: Windows release assets");
    expect(workflow).toContain("pnpm host:package:windows");
    expect(workflow).toContain("pnpm host:verify:windows");
    expect(workflow).toContain("pnpm smoke:browser-native -- --browser chrome --headless --required --host-path target/release/localhost-control-host.exe");
    expect(workflow).toContain("uses: browser-actions/setup-firefox@v1");
    expect(workflow).toContain("pnpm smoke:browser-native -- --browser firefox --headless --required --host-path target/release/localhost-control-host.exe");
    expect(workflow).toContain("dist/native-host/localhost-control-native-host-windows-*.zip");
    expect(workflow).toMatch(/needs:\s*\r?\n\s+- windows\r?\n\s+- linux\r?\n\s+- macos\r?\n\s+- macos-intel\r?\n\s+- extension/);
  });

  it("builds Linux release assets for amd64 and arm64 with matching artifact names", () => {
    expect(workflow).toContain("name: Linux release assets (${{ matrix.arch }})");
    expect(workflow).toContain("runner: ubuntu-24.04");
    expect(workflow).toContain("runner: ubuntu-24.04-arm");
    expect(workflow).toContain("node scripts/package-native-host.mjs --platform=linux --format=tarball --arch=${{ matrix.arch }}");
    expect(workflow).toContain("bash scripts/ci/smoke-installed-linux-deb.sh ${{ matrix.arch }}");
    expect(workflow).toContain("BROWSER_NATIVE_SMOKE_REQUIRED: ${{ matrix.arch == 'amd64' && 'true' || 'false' }}");
    expect(workflow).toContain("dist/native-host/localhost-control-native-host-linux-${{ matrix.arch }}-*.tar.gz");
    expect(workflow).toContain("dist/native-host/localhost-control-native-host_*_${{ matrix.arch }}.deb");
  });

  it("builds universal macOS release assets with correct names", () => {
    expect(workflow).toContain("rustup target add aarch64-apple-darwin x86_64-apple-darwin");
    expect(workflow).toContain("pnpm host:package:mac");
    expect(workflow).toContain("bash scripts/ci/smoke-installed-macos-pkg.sh");
    expect(workflow).toContain('BROWSER_NATIVE_SMOKE_REQUIRED: "true"');
    expect(workflow).toContain("dist/native-host/localhost-control-native-host-macos-universal-*.tar.gz");
    expect(workflow).toContain("dist/native-host/localhost-control-native-host-macos-universal-*.pkg");
  });

  it("runs macOS Intel compatibility before publishing releases", () => {
    expect(workflow).toContain("name: macOS Intel compatibility");
    expect(workflow).toContain("runs-on: macos-15-intel");
    expect(workflow).toMatch(/macos-intel:\s*\r?\n\s+name: macOS Intel compatibility\r?\n\s+runs-on: macos-15-intel\r?\n\s+needs: macos/);
    expect(workflow).toContain("name: release-macos");
    expect(workflow).toContain("path: dist/native-host");
    expect(workflow).toContain("Validate downloaded macOS tarball on Intel");
    expect(workflow).toContain("Validate downloaded macOS pkg on Intel");
    expect(workflow).toContain("Smoke downloaded macOS pkg on Intel");
    expect(workflow).toMatch(/Smoke downloaded macOS pkg on Intel\r?\n\s+env:\r?\n\s+BROWSER_NATIVE_SMOKE_REQUIRED: "true"\r?\n\s+run: bash scripts\/ci\/smoke-installed-macos-pkg\.sh/);
    expect(workflow).not.toContain("Package macOS pkg on Intel");
  });

  it("publishes extension store packages with the release", () => {
    expect(workflow).toContain("name: Extension store packages");
    expect(workflow).toContain("pnpm extension:package:chrome");
    expect(workflow).toContain("pnpm extension:package:firefox");
    expect(workflow).toContain("pnpm extension:verify");
    expect(workflow).toContain("pnpm extension:lint:firefox");
    expect(workflow).toContain("name: extension-store-packages");
    expect(workflow).toContain("dist/chrome-store/*.zip");
    expect(workflow).toContain("dist/firefox-addons/*.zip");
    expect(workflow).toContain("path: dist/extension-store");
    expect(workflow).toContain("dist/extension-store/**/*.zip");
  });

  it("publishes GitHub releases with the artifact release action", () => {
    expect(workflow).toContain("uses: softprops/action-gh-release@v2");
    expect(workflow).toContain("body_path: dist/release-notes.md");
    expect(workflow).toContain("fail_on_unmatched_files: true");
  });

  it("uses current-platform native host release scripts for local packaging", () => {
    expect(packageJson.scripts["host:package:release-local"]).toBe("node scripts/package-native-host-current.mjs");
    expect(packageJson.scripts["host:verify:release-local"]).toBe("node scripts/validate-native-host-current.mjs");
  });

  it("writes release checksums with the artifact-aware checksum script", () => {
    expect(workflow).toContain("node scripts/write-native-host-checksums.mjs");
    expect(workflow).not.toContain("sha256sum dist/native-host/* > dist/native-host/SHA256SUMS");
  });

  it("packages and validates extension store zips in the artifact workflow", () => {
    expect(artifactWorkflow).toContain("Package Chrome extension");
    expect(artifactWorkflow).toContain("pnpm extension:package:chrome");
    expect(artifactWorkflow).toContain("Package Firefox extension");
    expect(artifactWorkflow).toContain("pnpm extension:package:firefox");
    expect(artifactWorkflow).toContain("Verify extension packages");
    expect(artifactWorkflow).toContain("pnpm extension:verify");
    expect(artifactWorkflow).toContain("pnpm extension:lint:firefox");
    expect(artifactWorkflow).toContain("pnpm smoke:browser-native -- --browser chrome --headless --required --host-path target/release/localhost-control-host.exe");
    expect(artifactWorkflow).toContain("uses: browser-actions/setup-firefox@v1");
    expect(artifactWorkflow).toContain("pnpm smoke:browser-native -- --browser firefox --headless --required --host-path target/release/localhost-control-host.exe");
    expect(artifactWorkflow).toContain("BROWSER_NATIVE_SMOKE_REQUIRED: ${{ matrix.arch == 'amd64' && 'true' || 'false' }}");
    expect(artifactWorkflow).toContain('BROWSER_NATIVE_SMOKE_REQUIRED: "true"');
    expect(artifactWorkflow).toContain("localhost-control-extension-store-packages");
    expect(artifactWorkflow).toContain("dist/chrome-store/*.zip");
    expect(artifactWorkflow).toContain("dist/firefox-addons/*.zip");
    expect(artifactWorkflow).toContain("name: Linux native host (${{ matrix.arch }})");
    expect(artifactWorkflow).toContain("runner: ubuntu-24.04");
    expect(artifactWorkflow).toContain("runner: ubuntu-24.04-arm");
    expect(artifactWorkflow).toContain("bash scripts/ci/smoke-installed-linux-deb.sh ${{ matrix.arch }}");
    expect(artifactWorkflow).toContain("rustup target add aarch64-apple-darwin x86_64-apple-darwin");
    expect(artifactWorkflow).toContain("bash scripts/ci/smoke-installed-macos-pkg.sh");
    expect(artifactWorkflow).toContain("runs-on: macos-15-intel");
    expect(artifactWorkflow).toMatch(/macos-intel:\s*\r?\n\s+name: macOS Intel compatibility\r?\n\s+runs-on: macos-15-intel\r?\n\s+needs: macos/);
    expect(artifactWorkflow).toContain("name: localhost-control-native-host-macos");
    expect(artifactWorkflow).toContain("Validate downloaded macOS tarball on Intel");
    expect(artifactWorkflow).toContain("Validate downloaded macOS pkg on Intel");
    expect(artifactWorkflow).toContain("Smoke downloaded macOS pkg on Intel");
    expect(artifactWorkflow).toMatch(/Smoke downloaded macOS pkg on Intel\r?\n\s+env:\r?\n\s+BROWSER_NATIVE_SMOKE_REQUIRED: "true"\r?\n\s+run: bash scripts\/ci\/smoke-installed-macos-pkg\.sh/);
    expect(artifactWorkflow).not.toContain("Package macOS pkg on Intel");
  });
});
