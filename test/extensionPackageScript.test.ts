import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "..");
const script = readFileSync(resolve(repoRoot, "scripts/package-extension.mjs"), "utf8");
const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")) as {
  version: string;
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

  it("accepts space-separated CLI values for manual release checks", () => {
    const outputDir = join(tmpdir(), `localhost-control-extension-args-${process.pid}-${Date.now()}`);
    try {
      execFileSync("node", ["scripts/package-extension.mjs", "--target", "firefox", "--out-dir", outputDir], {
        cwd: repoRoot,
        stdio: "pipe"
      });

      expect(existsSync(join(outputDir, `localhost-control-${packageJson.version}-firefox.zip`))).toBe(true);
      expect(existsSync(resolve(repoRoot, "true"))).toBe(false);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
