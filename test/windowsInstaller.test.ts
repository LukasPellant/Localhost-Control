import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readInstaller = (name: string) => readFileSync(resolve(__dirname, "../installer/windows", name), "utf8");
const extensionId = "bbbajehdcpmkbnbehkfdkmepfibcjdoh";

const runPowerShell = (command: string, env: Record<string, string>) =>
  execFileSync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
    { encoding: "utf8", env: { ...process.env, ...env } }
  );

describe("Windows native host installer scripts", () => {
  it("uses matching all-browser defaults for install and uninstall", () => {
    expect(readInstaller("install.ps1")).toContain('$Browser = "all"');
    expect(readInstaller("uninstall.ps1")).toContain('$Browser = "all"');
  });

  it("supports isolated registry roots and writes the shared manifest description", () => {
    expect(readInstaller("install.ps1")).toContain('$RegistryRoot = "HKCU:\\Software"');
    expect(readInstaller("uninstall.ps1")).toContain('$RegistryRoot = "HKCU:\\Software"');
    expect(readInstaller("install.ps1")).toContain('"^-{1,2}registry-root$"');
    expect(readInstaller("uninstall.ps1")).toContain('"^-{1,2}registry-root$"');
    expect(readInstaller("install.ps1")).toContain('description = "Localhost Control native messaging host"');
  });

  it("registers Chrome and Chromium fallback keys when installing for Brave", () => {
    if (process.platform !== "win32") {
      return;
    }

    const tempRoot = mkdtempSync(join(tmpdir(), "localhost-control-installer-"));
    const registryRoot = `HKCU:\\Software\\LocalhostControlInstallerTest\\${process.pid}-${Date.now()}`;
    const installPath = join(tempRoot, "install.ps1");
    const outDir = join(tempRoot, "out");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(installPath, readInstaller("install.ps1"));
    writeFileSync(join(outDir, "localhost-control-host.exe"), "");

    try {
      runPowerShell(
        "& $env:INSTALL -SkipBuild -Browser brave -RegistryRoot $env:REGISTRY_ROOT -ExtensionId $env:EXTENSION_ID",
        { INSTALL: installPath, REGISTRY_ROOT: registryRoot, EXTENSION_ID: extensionId }
      );

      const suffixes = [
        "WOW6432Node\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\com.localhost_control.host",
        "BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\com.localhost_control.host",
        "WOW6432Node\\Google\\Chrome\\NativeMessagingHosts\\com.localhost_control.host",
        "Google\\Chrome\\NativeMessagingHosts\\com.localhost_control.host",
        "WOW6432Node\\Chromium\\NativeMessagingHosts\\com.localhost_control.host",
        "Chromium\\NativeMessagingHosts\\com.localhost_control.host"
      ];

      const output = runPowerShell(
        [
          "$suffixes = $env:SUFFIXES | ConvertFrom-Json",
          "$suffixes | ForEach-Object {",
          "  $keyPath = Join-Path $env:REGISTRY_ROOT $_",
          "  if (!(Test-Path $keyPath)) { throw \"Missing registry target: $keyPath\" }",
          "  (Get-Item -Path $keyPath).GetValue('')",
          "} | ConvertTo-Json"
        ].join("; "),
        { REGISTRY_ROOT: registryRoot, SUFFIXES: JSON.stringify(suffixes) }
      );
      const manifests = JSON.parse(output) as string[];

      expect(manifests).toHaveLength(suffixes.length);
      expect(new Set(manifests.map((manifest) => realpathSync.native(manifest)))).toEqual(
        new Set([realpathSync.native(join(outDir, "com.localhost_control.host.json"))])
      );
      expect(readFileSync(join(outDir, "com.localhost_control.host.json"), "utf8")).toContain(
        `chrome-extension://${extensionId}/`
      );
    } finally {
      runPowerShell("Remove-Item -Path $env:REGISTRY_ROOT -Recurse -Force -ErrorAction SilentlyContinue", {
        REGISTRY_ROOT: registryRoot
      });
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("registers and unregisters Firefox with allowed_extensions on Windows", () => {
    if (process.platform !== "win32") {
      return;
    }

    const firefoxExtensionId = "localhost-control-test@example.invalid";
    const tempRoot = mkdtempSync(join(tmpdir(), "localhost-control-firefox-installer-"));
    const registryRoot = `HKCU:\\Software\\LocalhostControlFirefoxInstallerTest\\${process.pid}-${Date.now()}`;
    const installPath = join(tempRoot, "install.ps1");
    const uninstallPath = join(tempRoot, "uninstall.ps1");
    const outDir = join(tempRoot, "out");
    const registrySuffix = "Mozilla\\NativeMessagingHosts\\com.localhost_control.host";
    mkdirSync(outDir, { recursive: true });
    writeFileSync(installPath, readInstaller("install.ps1"));
    writeFileSync(uninstallPath, readInstaller("uninstall.ps1"));
    writeFileSync(join(outDir, "localhost-control-host.exe"), "");

    try {
      runPowerShell(
        "& $env:INSTALL -SkipBuild -Browser firefox -RegistryRoot $env:REGISTRY_ROOT -FirefoxExtensionId $env:FIREFOX_EXTENSION_ID",
        { INSTALL: installPath, REGISTRY_ROOT: registryRoot, FIREFOX_EXTENSION_ID: firefoxExtensionId }
      );

      const output = runPowerShell(
        [
          "$keyPath = Join-Path $env:REGISTRY_ROOT $env:REGISTRY_SUFFIX",
          "if (!(Test-Path $keyPath)) { throw \"Missing Firefox registry target: $keyPath\" }",
          "$manifestPath = (Get-Item -Path $keyPath).GetValue('')",
          "$manifest = Get-Content -Raw $manifestPath | ConvertFrom-Json",
          "[pscustomobject]@{ ManifestPath = $manifestPath; AllowedExtensions = $manifest.allowed_extensions; HasAllowedOrigins = [bool]($manifest.PSObject.Properties.Name -contains 'allowed_origins') } | ConvertTo-Json"
        ].join("; "),
        { REGISTRY_ROOT: registryRoot, REGISTRY_SUFFIX: registrySuffix }
      );
      const manifest = JSON.parse(output) as {
        ManifestPath: string;
        AllowedExtensions: string[];
        HasAllowedOrigins: boolean;
      };

      expect(realpathSync.native(manifest.ManifestPath)).toBe(realpathSync.native(join(outDir, "com.localhost_control.host.firefox.json")));
      expect(manifest.AllowedExtensions).toEqual([firefoxExtensionId]);
      expect(manifest.HasAllowedOrigins).toBe(false);

      runPowerShell(
        "& $env:UNINSTALL -Browser firefox -RegistryRoot $env:REGISTRY_ROOT -KeepFiles",
        { UNINSTALL: uninstallPath, REGISTRY_ROOT: registryRoot }
      );
      const existsAfterUninstall = runPowerShell(
        "Test-Path (Join-Path $env:REGISTRY_ROOT $env:REGISTRY_SUFFIX)",
        { REGISTRY_ROOT: registryRoot, REGISTRY_SUFFIX: registrySuffix }
      ).trim();

      expect(existsAfterUninstall).toBe("False");
    } finally {
      runPowerShell("Remove-Item -Path $env:REGISTRY_ROOT -Recurse -Force -ErrorAction SilentlyContinue", {
        REGISTRY_ROOT: registryRoot
      });
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
