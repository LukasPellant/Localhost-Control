import { afterEach, describe, expect, it, vi } from "vitest";
import { clearBrowserDataForUrl, openPrivateWindowForUrl, originFromLocalhostUrl } from "./browserCleanup";

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
