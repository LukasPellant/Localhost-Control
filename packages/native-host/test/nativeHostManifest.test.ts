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
});
