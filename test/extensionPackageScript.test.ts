import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = readFileSync(resolve(__dirname, "../scripts/package-extension.mjs"), "utf8");
const packageJson = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

describe("package-extension.mjs", () => {
  it("packages Chrome and Firefox with the cross-platform Node script", () => {
    expect(packageJson.scripts["extension:package:chrome"]).toBe("node scripts/package-extension.mjs --target=chrome");
    expect(packageJson.scripts["extension:package:firefox"]).toBe("node scripts/package-extension.mjs --target=firefox");
  });

  it("prepares and zips an isolated staging directory for each target", () => {
    expect(script).toContain("mkdtemp(path.join(os.tmpdir(), `localhost-control-extension-${target}-`))");
    expect(script).toContain("prepare-extension-target.mjs");
    expect(script).toContain("validate-extension-package.mjs");
    expect(script).toContain("await writeZip(stageDir, zipPath)");
    expect(script).not.toContain("Compress-Archive");
  });

  it("writes valid deflated ZIP entries without relying on platform zip tools", () => {
    expect(script).toContain("deflateRawSync");
    expect(script).toContain("crc32");
    expect(script).toContain("0x04034b50");
    expect(script).toContain("0x02014b50");
    expect(script).toContain("0x06054b50");
  });

  it("serializes package builds because Vite writes to a shared dist directory", () => {
    expect(script).toContain("localhost-control-extension-package.lock");
    expect(script).toContain("acquirePackageLock");
    expect(script).toContain("Timed out waiting for the Localhost Control extension package lock.");
    expect(script).toContain("await releasePackageLock()");
  });
});
