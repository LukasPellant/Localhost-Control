import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "..");
const gitAttributes = readFileSync(resolve(repoRoot, ".gitattributes"), "utf8");
const artifactWorkflow = readFileSync(resolve(repoRoot, ".github/workflows/native-host-artifacts.yml"), "utf8");
const releaseWorkflow = readFileSync(resolve(repoRoot, ".github/workflows/release-native-host.yml"), "utf8");

describe("release install smoke scripts", () => {
  it("keeps release shell scripts and workflows on LF line endings", () => {
    expect(gitAttributes).toContain("*.sh text eol=lf");
    expect(gitAttributes).toContain("*.yml text eol=lf");
    expect(gitAttributes).toContain("*.yaml text eol=lf");
  });

  it("keeps platform install smoke logic in reusable scripts", () => {
    const linuxScript = resolve(repoRoot, "scripts/ci/smoke-installed-linux-deb.sh");
    const macosScript = resolve(repoRoot, "scripts/ci/smoke-installed-macos-pkg.sh");

    expect(existsSync(linuxScript)).toBe(true);
    expect(existsSync(macosScript)).toBe(true);

    const linux = readFileSync(linuxScript, "utf8");
    expect(linux).toContain("shopt -s nullglob");
    expect(linux).toContain("sudo dpkg -i");
    expect(linux).toContain("sudo dpkg -r localhost-control-native-host");
    expect(linux).toContain("/usr/lib/mozilla/native-messaging-hosts/com.localhost_control.host.json");
    expect(linux).toContain("invalid native host version response");

    const macos = readFileSync(macosScript, "utf8");
    expect(macos).toContain("shopt -s nullglob");
    expect(macos).toContain("sudo installer -pkg");
    expect(macos).toContain('sudo "/Library/Application Support/Localhost Control/uninstall.sh"');
    expect(macos).toContain("/Library/Application Support/Mozilla/NativeMessagingHosts/com.localhost_control.host.json");
    expect(macos).toContain("invalid native host version response");
  });

  it("calls reusable install smoke scripts from artifact and release workflows", () => {
    for (const workflow of [artifactWorkflow, releaseWorkflow]) {
      expect(workflow).toContain("bash scripts/ci/smoke-installed-linux-deb.sh ${{ matrix.arch }}");
      expect(workflow).toContain("bash scripts/ci/smoke-installed-macos-pkg.sh");
      expect(workflow).not.toContain("node <<'NODE'");
    }
  });
});
