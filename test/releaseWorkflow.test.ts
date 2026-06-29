import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(resolve(__dirname, "../.github/workflows/release-native-host.yml"), "utf8");
const packageJson = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

describe("release-native-host workflow", () => {
  it("checks out the requested release tag for manual dispatch builds", () => {
    const checkoutCount = (workflow.match(/uses: actions\/checkout@v4/g) ?? []).length;
    const pinnedRefCount = (workflow.match(/ref: \$\{\{ inputs\.tag \|\| github\.ref \}\}/g) ?? []).length;

    expect(checkoutCount).toBe(4);
    expect(pinnedRefCount).toBe(checkoutCount);
  });

  it("publishes Windows native host assets with the release", () => {
    expect(workflow).toContain("name: Windows release assets");
    expect(workflow).toContain("pnpm host:package:windows");
    expect(workflow).toContain("pnpm host:verify:windows");
    expect(workflow).toContain("dist/native-host/localhost-control-native-host-windows-*.zip");
    expect(workflow).toMatch(/needs:\s*\n\s+- windows\n\s+- linux\n\s+- macos/);
  });

  it("includes Windows artifacts in local release verification", () => {
    expect(packageJson.scripts["host:verify:release-local"]).toContain("pnpm host:verify:windows");
  });

  it("writes release checksums with the artifact-aware checksum script", () => {
    expect(workflow).toContain("node scripts/write-native-host-checksums.mjs");
    expect(workflow).not.toContain("sha256sum dist/native-host/* > dist/native-host/SHA256SUMS");
  });
});
