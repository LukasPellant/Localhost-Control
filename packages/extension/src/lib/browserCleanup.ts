import { getExtensionApi, hasPromiseExtensionApi } from "./extensionApi";

export type BrowserCleanupResult = {
  cleared: boolean;
  message: string;
  origin: string;
  reason?: "unavailable" | "permission-denied" | "failed";
};

export type BrowserCleanupMode = "all" | "cache";
export type BrowserPreviewPreset = "phone" | "tablet" | "desktop";

export type BrowserPrivateWindowResult = {
  opened: boolean;
  message: string;
  origin: string;
  url: string;
  reason?: "unavailable" | "failed";
};

export type BrowserMobilePreviewResult = {
  opened: boolean;
  message: string;
  origin: string;
  url: string;
  reason?: "unavailable" | "failed";
};

export type BrowserTabReloadResult = {
  reloaded: boolean;
  count: number;
  message: string;
  origin: string;
  reason?: "unavailable" | "permission-denied" | "failed";
};

const previewPresets = {
  phone: { label: "phone", width: 390, height: 844 },
  tablet: { label: "tablet", width: 768, height: 1024 },
  desktop: { label: "desktop", width: 1280, height: 800 }
} as const satisfies Record<BrowserPreviewPreset, { label: string; width: number; height: number }>;

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

const localhostHostPermissionPattern = (origin: string): string => {
  const url = new URL(origin);
  const hostname = url.hostname.toLowerCase();
  const host = hostname.endsWith(".localhost") ? "*.localhost" : hostname === "::1" || hostname === "[::1]" ? "[::1]" : hostname;
  return `${url.protocol}//${host}/*`;
};

const hasLocalhostHostPermission = async (origin: string): Promise<boolean> => {
  const api = getExtensionApi();
  const permissions = api?.permissions;
  if (!permissions?.request && !permissions?.contains) return true;

  const origins = [localhostHostPermissionPattern(origin)];
  if (permissions.contains) {
    if (hasPromiseExtensionApi()) {
      try {
        if (await permissions.contains({ origins })) return true;
      } catch {
        return false;
      }
    } else {
      const alreadyGranted = await new Promise<boolean>((resolve) => {
        permissions.contains?.({ origins }, (granted) => resolve(!api?.runtime?.lastError && Boolean(granted)));
      });
      if (alreadyGranted) return true;
    }
  }

  if (!permissions.request) return false;

  if (hasPromiseExtensionApi()) {
    try {
      return Boolean(await permissions.request({ origins }));
    } catch {
      return false;
    }
  }

  return new Promise((resolve) => {
    permissions.request?.({ origins }, (granted) => resolve(!api?.runtime?.lastError && Boolean(granted)));
  });
};

const queryTabsByUrlPattern = async (urlPattern: string): Promise<Array<{ id?: number; url?: string }>> => {
  const api = getExtensionApi();
  const tabs = api?.tabs;
  if (!tabs?.query) return [];

  if (hasPromiseExtensionApi()) {
    return (await tabs.query({ url: [urlPattern] })) ?? [];
  }

  return new Promise((resolve, reject) => {
    try {
      const result = tabs.query?.({ url: [urlPattern] }, (items) => {
        const runtimeError = api?.runtime?.lastError?.message;
        if (runtimeError) {
          reject(new Error(runtimeError));
          return;
        }
        resolve(items ?? []);
      });
      if (result instanceof Promise) {
        result.then((items) => resolve(items ?? [])).catch(reject);
      }
    } catch (error) {
      reject(error);
    }
  });
};

const reloadTabById = async (tabId: number): Promise<void> => {
  const api = getExtensionApi();
  const tabs = api?.tabs;
  if (!tabs?.reload) return;

  if (hasPromiseExtensionApi()) {
    await tabs.reload(tabId, { bypassCache: true });
    return;
  }

  await new Promise<void>((resolve, reject) => {
    try {
      const result = tabs.reload?.(tabId, { bypassCache: true }, () => {
        const runtimeError = api?.runtime?.lastError?.message;
        if (runtimeError) {
          reject(new Error(runtimeError));
          return;
        }
        resolve();
      });
      if (result instanceof Promise) {
        result.then(() => resolve()).catch(reject);
      }
    } catch (error) {
      reject(error);
    }
  });
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

export const openMobilePreviewForUrl = async (value: string, preset: BrowserPreviewPreset = "phone"): Promise<BrowserMobilePreviewResult> => {
  const origin = originFromLocalhostUrl(value);
  const windows = getExtensionApi()?.windows;
  const preview = previewPresets[preset];

  if (!windows?.create) {
    return {
      opened: false,
      message: "Mobile preview window API is unavailable.",
      origin,
      url: value,
      reason: "unavailable"
    };
  }

  try {
    await windows.create({
      url: value,
      type: "popup",
      width: preview.width,
      height: preview.height,
      focused: true
    });
  } catch (error) {
    return mobilePreviewFailureResult(origin, value, error);
  }

  const runtimeError = getExtensionApi()?.runtime?.lastError?.message;
  if (runtimeError) return mobilePreviewFailureResult(origin, value, runtimeError);

  return {
    opened: true,
    message: `Opened ${preview.label} preview for ${origin}.`,
    origin,
    url: value
  };
};

export const reloadLocalhostTabsForUrl = async (value: string): Promise<BrowserTabReloadResult> => {
  const origin = originFromLocalhostUrl(value);
  const tabs = getExtensionApi()?.tabs;

  if (!tabs?.query || !tabs.reload) {
    return {
      reloaded: false,
      count: 0,
      message: "Hard reload tab API is unavailable.",
      origin,
      reason: "unavailable"
    };
  }

  if (!(await hasLocalhostHostPermission(origin))) {
    return {
      reloaded: false,
      count: 0,
      message: `Hard reload needs permission for ${origin}.`,
      origin,
      reason: "permission-denied"
    };
  }

  let queriedTabs: Array<{ id?: number; url?: string }> = [];
  try {
    queriedTabs = await queryTabsByUrlPattern(localhostHostPermissionPattern(origin));
  } catch (error) {
    return tabReloadFailureResult(origin, error);
  }

  const matchingTabIds = queriedTabs.flatMap((tab) => {
    if (!tab.id || !tab.url) return [];
    try {
      return new URL(tab.url).origin === origin ? [tab.id] : [];
    } catch {
      return [];
    }
  });

  try {
    await Promise.all(matchingTabIds.map((tabId) => reloadTabById(tabId)));
  } catch (error) {
    return tabReloadFailureResult(origin, error);
  }

  const runtimeError = getExtensionApi()?.runtime?.lastError?.message;
  if (runtimeError) return tabReloadFailureResult(origin, runtimeError);

  if (!matchingTabIds.length) {
    return {
      reloaded: true,
      count: 0,
      message: `No open tabs found for ${origin}.`,
      origin
    };
  }

  return {
    reloaded: true,
    count: matchingTabIds.length,
    message: `Hard reloaded ${matchingTabIds.length} ${matchingTabIds.length === 1 ? "tab" : "tabs"} for ${origin}.`,
    origin
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

const mobilePreviewFailureResult = (origin: string, url: string, error: unknown): BrowserMobilePreviewResult => {
  const message = error instanceof Error ? error.message : String(error);
  return {
    opened: false,
    message: `Mobile preview failed for ${origin}: ${message}`,
    origin,
    url,
    reason: "failed"
  };
};

const tabReloadFailureResult = (origin: string, error: unknown): BrowserTabReloadResult => {
  const message = error instanceof Error ? error.message : String(error);
  return {
    reloaded: false,
    count: 0,
    message: `Hard reload failed for ${origin}: ${message}`,
    origin,
    reason: "failed"
  };
};
