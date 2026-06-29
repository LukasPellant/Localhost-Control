import os from "node:os";
import path from "node:path";

export const HOST_NAME = "com.localhost_control.host";
export const DEFAULT_EXTENSION_ID = "oamllgeaemchejbebgamdakjloahgjdc";

export const buildNativeHostManifest = ({ hostPath, extensionId = DEFAULT_EXTENSION_ID }) => {
  if (!path.isAbsolute(hostPath)) {
    throw new Error("Native messaging host path must be absolute.");
  }

  return {
    name: HOST_NAME,
    description: "Localhost Control native messaging host",
    path: hostPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`]
  };
};

export const resolveNativeMessagingManifestTargets = (platform, scope, homeDir = os.homedir()) => {
  if (platform === "darwin") {
    const root = scope === "system" ? "/Library" : path.posix.join(homeDir, "Library");
    return [
      { browser: "chrome", path: path.posix.join(root, "Application Support", "Google", "Chrome", "NativeMessagingHosts", `${HOST_NAME}.json`) },
      { browser: "brave", path: path.posix.join(root, "Application Support", "BraveSoftware", "Brave-Browser", "NativeMessagingHosts", `${HOST_NAME}.json`) }
    ];
  }

  if (platform === "linux") {
    if (scope === "system") {
      return [
        { browser: "chrome", path: path.posix.join("/etc", "opt", "chrome", "native-messaging-hosts", `${HOST_NAME}.json`) },
        { browser: "brave", path: path.posix.join("/etc", "brave", "native-messaging-hosts", `${HOST_NAME}.json`) }
      ];
    }

    return [
      { browser: "chrome", path: path.posix.join(homeDir, ".config", "google-chrome", "NativeMessagingHosts", `${HOST_NAME}.json`) },
      { browser: "brave", path: path.posix.join(homeDir, ".config", "BraveSoftware", "Brave-Browser", "NativeMessagingHosts", `${HOST_NAME}.json`) }
    ];
  }

  return [];
};
