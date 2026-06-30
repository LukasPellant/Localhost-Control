import { getExtensionApi, hasPromiseExtensionApi } from "./extensionApi";

export type BrowserCleanupResult = {
  cleared: boolean;
  message: string;
  origin: string;
};

export type BrowserCleanupMode = "all" | "cache";

const localhostNames = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"]);
const cleanupModes = {
  all: {
    label: "browser data",
    dataToRemove: {
      cacheStorage: true,
      cookies: true,
      indexedDB: true,
      localStorage: true,
      serviceWorkers: true
    }
  },
  cache: {
    label: "cache storage and service workers",
    dataToRemove: {
      cacheStorage: true,
      serviceWorkers: true
    }
  }
} as const satisfies Record<BrowserCleanupMode, { label: string; dataToRemove: Record<string, true> }>;

export const originFromLocalhostUrl = (value: string): string => {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (!localhostNames.has(host) && !host.endsWith(".localhost")) {
    throw new Error("Only localhost browser data can be cleared.");
  }
  return url.origin;
};

export const clearBrowserDataForUrl = async (value: string, mode: BrowserCleanupMode = "all"): Promise<BrowserCleanupResult> => {
  const origin = originFromLocalhostUrl(value);
  const hostname = new URL(origin).hostname;
  const browsingData = getExtensionApi()?.browsingData;
  const cleanupMode = cleanupModes[mode];
  if (!browsingData?.remove) {
    return {
      cleared: false,
      message: "Browser cleanup permission is unavailable.",
      origin
    };
  }

  const options = hasPromiseExtensionApi()
    ? {
        origin: [origin],
        hostnames: [hostname],
        originTypes: { unprotectedWeb: true }
      }
    : {
        origins: [origin],
        originTypes: { unprotectedWeb: true }
      };

  await browsingData.remove(options, cleanupMode.dataToRemove);

  return {
    cleared: true,
    message: `Cleared ${cleanupMode.label} for ${origin}.`,
    origin
  };
};
