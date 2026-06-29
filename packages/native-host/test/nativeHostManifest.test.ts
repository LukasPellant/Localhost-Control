import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildNativeHostManifest, resolveNativeMessagingManifestTargets } from "../src/nativeHostManifest";

describe("buildNativeHostManifest", () => {
  it("uses an absolute host path and the configured extension id", () => {
    const hostPath = path.resolve("/usr/lib/localhost-control/localhost-control-host");
    const manifest = buildNativeHostManifest({
      hostPath,
      extensionId: "oamllgeaemchejbebgamdakjloahgjdc"
    });

    expect(manifest).toEqual({
      name: "com.localhost_control.host",
      description: "Localhost Control native messaging host",
      path: hostPath,
      type: "stdio",
      allowed_origins: ["chrome-extension://oamllgeaemchejbebgamdakjloahgjdc/"]
    });
  });
});

describe("resolveNativeMessagingManifestTargets", () => {
  it("returns Chrome and Brave manifest paths for macOS and Linux", () => {
    expect(resolveNativeMessagingManifestTargets("darwin", "user").map((target) => target.browser)).toEqual(["chrome", "brave"]);
    expect(resolveNativeMessagingManifestTargets("linux", "user").map((target) => target.browser)).toEqual(["chrome", "brave"]);
    expect(resolveNativeMessagingManifestTargets("win32", "user")).toEqual([]);
  });

  it("resolves user and system install paths for macOS and Linux", () => {
    expect(resolveNativeMessagingManifestTargets("darwin", "user", "/Users/tester").map((target) => target.path)).toEqual([
      "/Users/tester/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.localhost_control.host.json",
      "/Users/tester/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.localhost_control.host.json"
    ]);
    expect(resolveNativeMessagingManifestTargets("darwin", "system", "/Users/tester").map((target) => target.path)).toEqual([
      "/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.localhost_control.host.json",
      "/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.localhost_control.host.json"
    ]);
    expect(resolveNativeMessagingManifestTargets("linux", "user", "/home/tester").map((target) => target.path)).toEqual([
      "/home/tester/.config/google-chrome/NativeMessagingHosts/com.localhost_control.host.json",
      "/home/tester/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.localhost_control.host.json"
    ]);
    expect(resolveNativeMessagingManifestTargets("linux", "system", "/home/tester").map((target) => target.path)).toEqual([
      "/etc/opt/chrome/native-messaging-hosts/com.localhost_control.host.json",
      "/etc/brave/native-messaging-hosts/com.localhost_control.host.json"
    ]);
  });
});
