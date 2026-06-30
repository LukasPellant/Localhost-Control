import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearBrowserDataForUrl,
  openMobilePreviewForUrl,
  openPrivateWindowForUrl,
  originFromLocalhostUrl,
  reloadLocalhostTabsForUrl
} from "./browserCleanup";

afterEach(() => {
  Reflect.deleteProperty(globalThis, "chrome");
  Reflect.deleteProperty(globalThis, "browser");
});

describe("originFromLocalhostUrl", () => {
  it("normalizes localhost app URLs to their origin", () => {
    expect(originFromLocalhostUrl("http://127.0.0.1:5173/dashboard?token=old")).toBe("http://127.0.0.1:5173");
    expect(originFromLocalhostUrl("https://myapp.localhost/admin")).toBe("https://myapp.localhost");
  });

  it("rejects non-local origins", () => {
    expect(() => originFromLocalhostUrl("https://example.com")).toThrow("Only localhost browser data can be cleared.");
  });
});

describe("clearBrowserDataForUrl", () => {
  it("reports unavailable cleanup APIs without throwing", async () => {
    await expect(clearBrowserDataForUrl("http://127.0.0.1:5173")).resolves.toEqual({
      cleared: false,
      message: "Browser cleanup permission is unavailable.",
      origin: "http://127.0.0.1:5173",
      reason: "unavailable"
    });
  });

  it("clears the selected localhost origin through Chrome browsingData", async () => {
    const remove = vi.fn(async () => undefined);
    (globalThis as { chrome?: unknown }).chrome = {
      browsingData: { remove }
    };

    await expect(clearBrowserDataForUrl("http://127.0.0.1:5173/dashboard")).resolves.toEqual({
      cleared: true,
      message: "Cleared browser data for http://127.0.0.1:5173.",
      origin: "http://127.0.0.1:5173"
    });
    expect(remove).toHaveBeenCalledWith(
      { origins: ["http://127.0.0.1:5173"], originTypes: { unprotectedWeb: true } },
      {
        cacheStorage: true,
        cookies: true,
        indexedDB: true,
        localStorage: true,
        serviceWorkers: true
      }
    );
  });

  it("clears the selected localhost origin through Firefox browsingData", async () => {
    const remove = vi.fn(async () => undefined);
    (globalThis as { browser?: unknown }).browser = {
      browsingData: { remove }
    };

    await clearBrowserDataForUrl("http://127.0.0.1:5173/dashboard");

    expect(remove).toHaveBeenCalledWith(
      {
        origin: ["http://127.0.0.1:5173"],
        hostnames: ["127.0.0.1"],
        originTypes: { unprotectedWeb: true }
      },
      {
        cacheStorage: true,
        cookies: true,
        indexedDB: true,
        localStorage: true,
        serviceWorkers: true
      }
    );
  });

  it("can clear only runtime cache and service workers for a localhost origin", async () => {
    const remove = vi.fn(async () => undefined);
    (globalThis as { browser?: unknown }).browser = {
      browsingData: { remove }
    };

    await expect(clearBrowserDataForUrl("http://127.0.0.1:5173/dashboard", "cache")).resolves.toEqual({
      cleared: true,
      message: "Cleared cache storage and service workers for http://127.0.0.1:5173.",
      origin: "http://127.0.0.1:5173"
    });
    expect(remove).toHaveBeenCalledWith(
      {
        origin: ["http://127.0.0.1:5173"],
        hostnames: ["127.0.0.1"],
        originTypes: { unprotectedWeb: true }
      },
      {
        cacheStorage: true,
        serviceWorkers: true
      }
    );
  });

  it("keeps cache-only cleanup limited to localhost origins", async () => {
    await expect(clearBrowserDataForUrl("https://example.com/app", "cache")).rejects.toThrow("Only localhost browser data can be cleared.");
  });

  it("reports permission-denied cleanup failures without throwing", async () => {
    const remove = vi.fn(async () => {
      throw new Error("Permission denied to remove browsing data.");
    });
    (globalThis as { chrome?: unknown }).chrome = {
      browsingData: { remove }
    };

    await expect(clearBrowserDataForUrl("http://127.0.0.1:5173/dashboard")).resolves.toEqual({
      cleared: false,
      message: "Browser cleanup permission was denied for http://127.0.0.1:5173.",
      origin: "http://127.0.0.1:5173",
      reason: "permission-denied"
    });
  });

  it("reports Chrome runtime cleanup errors without throwing", async () => {
    const remove = vi.fn(() => undefined);
    (globalThis as { chrome?: unknown }).chrome = {
      browsingData: { remove },
      runtime: { lastError: { message: "Browsing data removal failed." } }
    };

    await expect(clearBrowserDataForUrl("http://127.0.0.1:5173/dashboard", "cache")).resolves.toEqual({
      cleared: false,
      message: "Browser cleanup failed for http://127.0.0.1:5173: Browsing data removal failed.",
      origin: "http://127.0.0.1:5173",
      reason: "failed"
    });
  });
});

describe("openPrivateWindowForUrl", () => {
  it("reports unavailable window APIs without throwing", async () => {
    await expect(openPrivateWindowForUrl("http://127.0.0.1:5173/dashboard")).resolves.toEqual({
      opened: false,
      message: "Private window API is unavailable.",
      origin: "http://127.0.0.1:5173",
      url: "http://127.0.0.1:5173/dashboard",
      reason: "unavailable"
    });
  });

  it("opens localhost app URLs in a private browser window", async () => {
    const create = vi.fn(async () => ({ id: 10 }));
    (globalThis as { browser?: unknown }).browser = {
      windows: { create }
    };

    await expect(openPrivateWindowForUrl("http://127.0.0.1:5173/dashboard?fresh=1")).resolves.toEqual({
      opened: true,
      message: "Opened private window for http://127.0.0.1:5173.",
      origin: "http://127.0.0.1:5173",
      url: "http://127.0.0.1:5173/dashboard?fresh=1"
    });
    expect(create).toHaveBeenCalledWith({
      url: "http://127.0.0.1:5173/dashboard?fresh=1",
      type: "normal",
      incognito: true
    });
  });

  it("keeps private window opens limited to localhost URLs", async () => {
    await expect(openPrivateWindowForUrl("https://example.com/dashboard")).rejects.toThrow("Only localhost browser data can be cleared.");
  });

  it("reports incognito window failures without throwing", async () => {
    const create = vi.fn(async () => {
      throw new Error("Incognito mode is disabled.");
    });
    (globalThis as { chrome?: unknown }).chrome = {
      windows: { create }
    };

    await expect(openPrivateWindowForUrl("http://127.0.0.1:5173/dashboard")).resolves.toEqual({
      opened: false,
      message: "Private window failed for http://127.0.0.1:5173: Incognito mode is disabled.",
      origin: "http://127.0.0.1:5173",
      url: "http://127.0.0.1:5173/dashboard",
      reason: "failed"
    });
  });
});

describe("reloadLocalhostTabsForUrl", () => {
  it("reports unavailable tab APIs without throwing", async () => {
    await expect(reloadLocalhostTabsForUrl("http://127.0.0.1:5173/dashboard")).resolves.toEqual({
      reloaded: false,
      count: 0,
      message: "Hard reload tab API is unavailable.",
      origin: "http://127.0.0.1:5173",
      reason: "unavailable"
    });
  });

  it("hard reloads only tabs matching the exact localhost origin", async () => {
    const contains = vi.fn(async () => false);
    const request = vi.fn(async () => true);
    const query = vi.fn(async () => [
      { id: 1, url: "http://127.0.0.1:5173/dashboard" },
      { id: 2, url: "http://127.0.0.1:5173/admin" },
      { id: 3, url: "http://127.0.0.1:5174/dashboard" },
      { id: 4, url: "https://myapp.localhost/dashboard" },
      { url: "http://127.0.0.1:5173/missing-id" }
    ]);
    const reload = vi.fn(async () => undefined);
    (globalThis as { browser?: unknown }).browser = {
      permissions: { contains, request },
      tabs: { query, reload }
    };

    await expect(reloadLocalhostTabsForUrl("http://127.0.0.1:5173/dashboard?fresh=1")).resolves.toEqual({
      reloaded: true,
      count: 2,
      message: "Hard reloaded 2 tabs for http://127.0.0.1:5173.",
      origin: "http://127.0.0.1:5173"
    });
    expect(contains).toHaveBeenCalledWith({ origins: ["http://127.0.0.1/*"] });
    expect(request).toHaveBeenCalledWith({ origins: ["http://127.0.0.1/*"] });
    expect(query).toHaveBeenCalledWith({ url: ["http://127.0.0.1/*"] });
    expect(reload).toHaveBeenNthCalledWith(1, 1, { bypassCache: true });
    expect(reload).toHaveBeenNthCalledWith(2, 2, { bypassCache: true });
  });

  it("uses existing localhost host permission before querying tabs", async () => {
    const contains = vi.fn(async () => true);
    const request = vi.fn(async () => false);
    const query = vi.fn(async () => []);
    const reload = vi.fn(async () => undefined);
    (globalThis as { browser?: unknown }).browser = {
      permissions: { contains, request },
      tabs: { query, reload }
    };

    await expect(reloadLocalhostTabsForUrl("https://shop.localhost:8443/app")).resolves.toEqual({
      reloaded: true,
      count: 0,
      message: "No open tabs found for https://shop.localhost:8443.",
      origin: "https://shop.localhost:8443"
    });
    expect(contains).toHaveBeenCalledWith({ origins: ["https://*.localhost/*"] });
    expect(request).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith({ url: ["https://*.localhost/*"] });
    expect(reload).not.toHaveBeenCalled();
  });

  it("supports callback-style Chrome tab query and reload APIs", async () => {
    const contains = vi.fn((_permissions, callback: (granted: boolean) => void) => callback(true));
    const query = vi.fn((_queryInfo, callback: (tabs: Array<{ id?: number; url?: string }>) => void) =>
      callback([
        { id: 21, url: "http://127.0.0.1:5173/dashboard" },
        { id: 22, url: "http://127.0.0.1:5174/dashboard" }
      ])
    );
    const reload = vi.fn((_tabId, _reloadProperties, callback: () => void) => callback());
    (globalThis as { chrome?: unknown }).chrome = {
      permissions: { contains },
      tabs: { query, reload }
    };

    await expect(reloadLocalhostTabsForUrl("http://127.0.0.1:5173/dashboard")).resolves.toEqual({
      reloaded: true,
      count: 1,
      message: "Hard reloaded 1 tab for http://127.0.0.1:5173.",
      origin: "http://127.0.0.1:5173"
    });
    expect(query).toHaveBeenCalledWith({ url: ["http://127.0.0.1/*"] }, expect.any(Function));
    expect(reload).toHaveBeenCalledWith(21, { bypassCache: true }, expect.any(Function));
  });

  it("reports denied localhost tab permission without querying tabs", async () => {
    const query = vi.fn();
    const request = vi.fn(async () => false);
    (globalThis as { browser?: unknown }).browser = {
      permissions: { request },
      tabs: { query, reload: vi.fn() }
    };

    await expect(reloadLocalhostTabsForUrl("http://127.0.0.1:5173/dashboard")).resolves.toEqual({
      reloaded: false,
      count: 0,
      message: "Hard reload needs permission for http://127.0.0.1:5173.",
      origin: "http://127.0.0.1:5173",
      reason: "permission-denied"
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("keeps hard reloads limited to localhost URLs", async () => {
    await expect(reloadLocalhostTabsForUrl("https://example.com/dashboard")).rejects.toThrow("Only localhost browser data can be cleared.");
  });
});

describe("openMobilePreviewForUrl", () => {
  it("reports unavailable mobile preview APIs without throwing", async () => {
    await expect(openMobilePreviewForUrl("http://127.0.0.1:5173/dashboard")).resolves.toEqual({
      opened: false,
      message: "Mobile preview window API is unavailable.",
      origin: "http://127.0.0.1:5173",
      url: "http://127.0.0.1:5173/dashboard",
      reason: "unavailable"
    });
  });

  it("opens localhost app URLs in focused responsive preview popups", async () => {
    const create = vi.fn(async () => ({ id: 14 }));
    (globalThis as { browser?: unknown }).browser = {
      windows: { create }
    };

    await expect(openMobilePreviewForUrl("http://127.0.0.1:5173/dashboard?device=phone")).resolves.toEqual({
      opened: true,
      message: "Opened phone preview for http://127.0.0.1:5173.",
      origin: "http://127.0.0.1:5173",
      url: "http://127.0.0.1:5173/dashboard?device=phone"
    });
    expect(create).toHaveBeenNthCalledWith(1, {
      url: "http://127.0.0.1:5173/dashboard?device=phone",
      type: "popup",
      width: 390,
      height: 844,
      focused: true
    });

    await expect(openMobilePreviewForUrl("http://127.0.0.1:5173/dashboard", "tablet")).resolves.toMatchObject({
      opened: true,
      message: "Opened tablet preview for http://127.0.0.1:5173."
    });
    expect(create).toHaveBeenNthCalledWith(2, {
      url: "http://127.0.0.1:5173/dashboard",
      type: "popup",
      width: 768,
      height: 1024,
      focused: true
    });

    await expect(openMobilePreviewForUrl("http://127.0.0.1:5173/dashboard", "desktop")).resolves.toMatchObject({
      opened: true,
      message: "Opened desktop preview for http://127.0.0.1:5173."
    });
    expect(create).toHaveBeenNthCalledWith(3, {
      url: "http://127.0.0.1:5173/dashboard",
      type: "popup",
      width: 1280,
      height: 800,
      focused: true
    });
  });

  it("keeps mobile previews limited to localhost URLs", async () => {
    await expect(openMobilePreviewForUrl("https://example.com/dashboard")).rejects.toThrow("Only localhost browser data can be cleared.");
  });

  it("reports mobile preview failures without throwing", async () => {
    const create = vi.fn(async () => {
      throw new Error("Popup windows are disabled.");
    });
    (globalThis as { chrome?: unknown }).chrome = {
      windows: { create }
    };

    await expect(openMobilePreviewForUrl("http://127.0.0.1:5173/dashboard")).resolves.toEqual({
      opened: false,
      message: "Mobile preview failed for http://127.0.0.1:5173: Popup windows are disabled.",
      origin: "http://127.0.0.1:5173",
      url: "http://127.0.0.1:5173/dashboard",
      reason: "failed"
    });
  });
});
