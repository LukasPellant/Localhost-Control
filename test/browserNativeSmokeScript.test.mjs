import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8"));

let buildChromiumLaunchArgs;
let buildChromiumNativeManifest;
let buildFirefoxNativeManifest;
let buildFirefoxSmokeManifest;
let buildWindowsBrowserCleanupCommand;
let browserExecutableCommandNames;
let chromiumRegistrySuffixes;
let computeChromiumExtensionId;
let describeRuntimeEvaluationFailure;
let firefoxUserManifestPaths;
let main;
let parseBrowserNativeSmokeArgs;
let webExtCliPath;

describe("smoke-browser-native.mjs", () => {
  beforeAll(async () => {
    const smoke = await import("../scripts/smoke-browser-native.mjs");
    buildChromiumLaunchArgs = smoke.buildChromiumLaunchArgs;
    buildChromiumNativeManifest = smoke.buildChromiumNativeManifest;
    buildFirefoxNativeManifest = smoke.buildFirefoxNativeManifest;
    buildFirefoxSmokeManifest = smoke.buildFirefoxSmokeManifest;
    buildWindowsBrowserCleanupCommand = smoke.buildWindowsBrowserCleanupCommand;
    browserExecutableCommandNames = smoke.browserExecutableCommandNames;
    chromiumRegistrySuffixes = smoke.chromiumRegistrySuffixes;
    computeChromiumExtensionId = smoke.computeChromiumExtensionId;
    describeRuntimeEvaluationFailure = smoke.describeRuntimeEvaluationFailure;
    firefoxUserManifestPaths = smoke.firefoxUserManifestPaths;
    main = smoke.main;
    parseBrowserNativeSmokeArgs = smoke.parseBrowserNativeSmokeArgs;
    webExtCliPath = smoke.webExtCliPath;
  });

  it("is exposed as an opt-in release smoke script", () => {
    expect(packageJson.scripts["smoke:browser-native"]).toBe("node scripts/smoke-browser-native.mjs");
  });

  it("parses browser smoke arguments without making the smoke mandatory by default", () => {
    const parsed = parseBrowserNativeSmokeArgs(["--browser", "brave", "--browser-exe", "C:/Brave/brave.exe", "--required"]);

    expect(parsed.browser).toBe("brave");
    expect(parsed.browserExe).toBe("C:/Brave/brave.exe");
    expect(parsed.hostName).toBe("com.localhost_control.host_smoke");
    expect(parsed.required).toBe(true);
    expect(parseBrowserNativeSmokeArgs(["--browser", "chrome", "--headless"]).headless).toBe(true);
    expect(parseBrowserNativeSmokeArgs(["--browser", "firefox", "--use-installed-host"]).hostName).toBe("com.localhost_control.host");
    expect(parseBrowserNativeSmokeArgs(["--browser", "firefox", "--use-installed-host"]).extensionId).toBe("localhost-control@lukaspellant.dev");
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
    const headlessArgs = buildChromiumLaunchArgs({
      browser: "chrome",
      extensionDir: "D:/repo/packages/extension/dist",
      headless: true,
      remoteDebuggingPort: 45678,
      userDataDir: "D:/tmp/localhost-control-browser-smoke"
    });
    expect(headlessArgs).toContain("--headless=new");
    expect(headlessArgs).toContain("--no-sandbox");
    expect(headlessArgs).toContain("--disable-dev-shm-usage");
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

  it("builds Firefox native messaging manifests with allowed extension ids", () => {
    expect(
      buildFirefoxNativeManifest({
        extensionId: "localhost-control-smoke@example.invalid",
        hostPath: "D:/repo/target/release/localhost-control-host.exe"
      })
    ).toEqual({
      name: "com.localhost_control.host",
      description: "Localhost Control native messaging host",
      path: "D:/repo/target/release/localhost-control-host.exe",
      type: "stdio",
      allowed_extensions: ["localhost-control-smoke@example.invalid"]
    });
  });

  it("builds a Firefox smoke extension that can call native messaging", () => {
    expect(buildFirefoxSmokeManifest({ extensionId: "localhost-control-smoke@example.invalid" })).toMatchObject({
      manifest_version: 2,
      applications: {
        gecko: {
          id: "localhost-control-smoke@example.invalid"
        }
      },
      permissions: ["nativeMessaging", "http://127.0.0.1/*"],
      background: {
        scripts: ["background.js"]
      }
    });
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

  it("does not fall back from Google Chrome smoke coverage to Chromium on Linux", () => {
    expect(browserExecutableCommandNames("chrome", "linux")).toEqual(["google-chrome", "google-chrome-stable"]);
    expect(browserExecutableCommandNames("chrome", "linux").join("\n")).not.toMatch(/chromium/i);
  });

  it("can discover Firefox from PATH on every CI platform", () => {
    expect(browserExecutableCommandNames("firefox", "win32")).toContain("firefox");
    expect(browserExecutableCommandNames("firefox", "darwin")).toContain("firefox");
    expect(browserExecutableCommandNames("firefox", "linux")).toContain("firefox");
  });

  it("uses Firefox native messaging user manifest locations on Unix platforms", () => {
    const macosPaths = firefoxUserManifestPaths("/tmp/localhost-control-home", "com.localhost_control.host", "darwin");
    const linuxPaths = firefoxUserManifestPaths("/tmp/localhost-control-home", "com.localhost_control.host", "linux");

    expect(macosPaths[0]).toContain("Library");
    expect(macosPaths[0]).toContain("Mozilla");
    expect(macosPaths[0]).toContain("com.localhost_control.host.json");
    expect(linuxPaths[0]).toContain(".mozilla");
    expect(linuxPaths[0]).toContain("native-messaging-hosts");
    expect(linuxPaths[0]).toContain("com.localhost_control.host.json");
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

  it("does not let a required Firefox manual gate pass without explicit confirmation", async () => {
    await expect(main(["--browser", "firefox", "--manual-gate", "--required"])).rejects.toThrow(
      /FIREFOX_NATIVE_SMOKE_CONFIRMED=true/
    );

    await expect(
      main(["--browser", "firefox", "--manual-gate", "--required", "--manual-confirmed"])
    ).resolves.toBeUndefined();
  });

  it("rejects installed manifest smoke for Chromium-family browsers", async () => {
    await expect(main(["--browser", "chrome", "--use-installed-host"])).rejects.toThrow(/supported only for Firefox/);
  });

  it("launches web-ext through the Node CLI entrypoint instead of a platform shell wrapper", () => {
    expect(webExtCliPath()).toMatch(/node_modules[\\/]+web-ext[\\/]+bin[\\/]+web-ext\.js$/);
  });
});
