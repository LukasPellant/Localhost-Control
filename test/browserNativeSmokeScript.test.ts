import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildChromiumLaunchArgs,
  buildChromiumNativeManifest,
  buildWindowsBrowserCleanupCommand,
  chromiumRegistrySuffixes,
  computeChromiumExtensionId,
  describeRuntimeEvaluationFailure,
  parseBrowserNativeSmokeArgs
} from "../scripts/smoke-browser-native.mjs";

const packageJson = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

describe("smoke-browser-native.mjs", () => {
  it("is exposed as an opt-in release smoke script", () => {
    expect(packageJson.scripts["smoke:browser-native"]).toBe("node scripts/smoke-browser-native.mjs");
  });

  it("parses browser smoke arguments without making the smoke mandatory by default", () => {
    const parsed = parseBrowserNativeSmokeArgs(["--browser", "brave", "--browser-exe", "C:/Brave/brave.exe", "--required"]);

    expect(parsed.browser).toBe("brave");
    expect(parsed.browserExe).toBe("C:/Brave/brave.exe");
    expect(parsed.hostName).toBe("com.localhost_control.host_smoke");
    expect(parsed.required).toBe(true);
  });

  it("builds Chromium launch arguments for a temporary profile and unpacked extension", () => {
    const args = buildChromiumLaunchArgs({
      browser: "chrome",
      extensionDir: "D:/repo/packages/extension/dist",
      remoteDebuggingPort: 45678,
      userDataDir: "D:/tmp/localhost-control-browser-smoke"
    });

    expect(args).toContain("--remote-debugging-port=45678");
    expect(args).toContain("--user-data-dir=D:/tmp/localhost-control-browser-smoke");
    expect(args).toContain("--load-extension=D:/repo/packages/extension/dist");
    expect(args).toContain("--disable-extensions-except=D:/repo/packages/extension/dist");
    expect(args).toContain("--no-first-run");
    expect(args.at(-1)).toBe("about:blank");
    expect(
      buildChromiumLaunchArgs({
        browser: "chrome",
        extensionDir: "D:/repo/packages/extension/dist",
        initialUrl: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/sidepanel.html",
        remoteDebuggingPort: 45678,
        userDataDir: "D:/tmp/localhost-control-browser-smoke"
      }).at(-1)
    ).toBe("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/sidepanel.html");
  });

  it("builds a Chromium native messaging manifest for the discovered extension id", () => {
    const manifest = buildChromiumNativeManifest({
      extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      hostPath: "D:/repo/target/release/localhost-control-host.exe"
    });

    expect(manifest).toEqual({
      name: "com.localhost_control.host",
      description: "Localhost Control native messaging host",
      path: "D:/repo/target/release/localhost-control-host.exe",
      type: "stdio",
      allowed_origins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
    });
    expect(
      buildChromiumNativeManifest({
        extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        hostName: "com.localhost_control.host_smoke",
        hostPath: "D:/repo/target/release/localhost-control-host.exe"
      }).name
    ).toBe("com.localhost_control.host_smoke");
  });

  it("computes the Chromium extension id from a manifest public key", () => {
    const publicKey =
      "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuQImu8n60asuT7jOg6JJq2Ls8XenZD3Tcfav40BIkbOMIUS8GmizsQvnardSV8+1w4bM6zYUpy6xiq+V/ZnRrAxGzTK539uglzfbUQs549iPFQE+Ly7glb/Ga3rdXqb63A21oRHZcc9ION4RxA0rztwZ0C8xaI7iMHYdsqMD6Kbbys6rIT2+MXmi0NoEBrZzo4JkzP7MDPsNK/e+I8G4NZlcPVr1D6J2WA0gaXQUvKT8Fr/XDvAMASaxSIF5gXq8I+IIF3nBhwaM+BnBvfQngnXQSIbAgtDQvKUbm/IrBFZUBIHXu0XIKf177YF+brki8jEAq9d2YJN5noYNo7UZhQIDAQAB";

    expect(computeChromiumExtensionId(publicKey)).toBe("peclmaffadakchaenecocelddcbggalg");
  });

  it("knows the real Chromium-family registry suffixes used by browsers on Windows", () => {
    expect(chromiumRegistrySuffixes("chrome")).toContain("Google\\Chrome\\NativeMessagingHosts\\com.localhost_control.host");
    expect(chromiumRegistrySuffixes("brave")).toContain("BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\com.localhost_control.host");
  });

  it("uses the temp profile path to clean up Chromium child processes on Windows", () => {
    const command = buildWindowsBrowserCleanupCommand();

    expect(command).toContain("Get-CimInstance Win32_Process");
    expect(command).toContain("LOCALHOST_CONTROL_BROWSER_USER_DATA_DIR");
    expect(command).toContain("Invoke-CimMethod");
  });

  it("surfaces native messaging runtime errors instead of masking them as empty objects", () => {
    expect(
      describeRuntimeEvaluationFailure({
        exceptionDetails: {
          exception: {
            description: "Error: Specified native messaging host not found."
          }
        }
      })
    ).toContain("Specified native messaging host not found");
  });
});
