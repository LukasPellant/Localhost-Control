import { getExtensionApi, hasPromiseExtensionApi } from "./extensionApi";

export type BrowserCleanupResult = {
  cleared: boolean;
  message: string;
  origin: string;
  reason?: "unavailable" | "permission-denied" | "failed";
};

export type BrowserCleanupMode = "all" | "cache";

export type BrowserPrivateWindowResult = {
  opened: boolean;
  message: string;
  origin: string;
  url: string;
  reason?: "unavailable" | "failed";
};

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
      origin,
      reason: "unavailable"
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

  try {
    await browsingData.remove(options, cleanupMode.dataToRemove);
  } catch (error) {
    return cleanupFailureResult(origin, error);
  }

  const runtimeError = getExtensionApi()?.runtime?.lastError?.message;
  if (runtimeError) return cleanupFailureResult(origin, runtimeError);

  return {
    cleared: true,
    message: `Cleared ${cleanupMode.label} for ${origin}.`,
    origin
  };
};

export const openPrivateWindowForUrl = async (value: string): Promise<BrowserPrivateWindowResult> => {
  const origin = originFromLocalhostUrl(value);
  const windows = getExtensionApi()?.windows;

  if (!windows?.create) {
    return {
      opened: false,
      message: "Private window API is unavailable.",
      origin,
      url: value,
      reason: "unavailable"
    };
  }

  try {
    await windows.create({ url: value, type: "normal", incognito: true });
  } catch (error) {
    return privateWindowFailureResult(origin, value, error);
  }

  const runtimeError = getExtensionApi()?.runtime?.lastError?.message;
  if (runtimeError) return privateWindowFailureResult(origin, value, runtimeError);

  return {
    opened: true,
    message: `Opened private window for ${origin}.`,
    origin,
    url: value
  };
};

const cleanupFailureResult = (origin: string, error: unknown): BrowserCleanupResult => {
  const message = error instanceof Error ? error.message : String(error);
  const permissionDenied = /permission|denied|not allowed|not permitted/i.test(message);
  return {
    cleared: false,
    message: permissionDenied ? `Browser cleanup permission was denied for ${origin}.` : `Browser cleanup failed for ${origin}: ${message}`,
    origin,
    reason: permissionDenied ? "permission-denied" : "failed"
  };
};

const privateWindowFailureResult = (origin: string, url: string, error: unknown): BrowserPrivateWindowResult => {
  const message = error instanceof Error ? error.message : String(error);
  return {
    opened: false,
    message: `Private window failed for ${origin}: ${message}`,
    origin,
    url,
    reason: "failed"
  };
};
