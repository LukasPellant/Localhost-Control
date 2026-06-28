import os from "node:os";
import path from "node:path";
import { HOST_NAME } from "@localhost-control/shared";

export const DEFAULT_EXTENSION_ID = "oamllgeaemchejbebgamdakjloahgjdc";

export type NativeHostManifest = {
  name: typeof HOST_NAME;
  description: string;
  path: string;
  type: "stdio";
  allowed_origins: string[];
};

export type BrowserTarget = {
  browser: "chrome" | "brave";
  path: string;
};

export const buildNativeHostManifest = ({
  hostPath,
  extensionId = DEFAULT_EXTENSION_ID
}: {
  hostPath: string;
  extensionId?: string;
}): NativeHostManifest => {
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

export const resolveNativeMessagingManifestTargets = (
  platform: NodeJS.Platform,
  scope: "user" | "system",
  homeDir = os.homedir()
): BrowserTarget[] => {
  if (platform === "darwin") {
    const root = scope === "system" ? "/Library" : path.join(homeDir, "Library");
    return [
      { browser: "chrome", path: path.join(root, "Application Support", "Google", "Chrome", "NativeMessagingHosts", `${HOST_NAME}.json`) },
      { browser: "brave", path: path.join(root, "Application Support", "BraveSoftware", "Brave-Browser", "NativeMessagingHosts", `${HOST_NAME}.json`) }
    ];
  }

  if (platform === "linux") {
    if (scope === "system") {
      return [
        { browser: "chrome", path: path.join("/etc", "opt", "chrome", "native-messaging-hosts", `${HOST_NAME}.json`) },
        { browser: "brave", path: path.join("/etc", "brave", "native-messaging-hosts", `${HOST_NAME}.json`) }
      ];
    }

    return [
      { browser: "chrome", path: path.join(homeDir, ".config", "google-chrome", "NativeMessagingHosts", `${HOST_NAME}.json`) },
      { browser: "brave", path: path.join(homeDir, ".config", "BraveSoftware", "Brave-Browser", "NativeMessagingHosts", `${HOST_NAME}.json`) }
    ];
  }

  return [];
};
