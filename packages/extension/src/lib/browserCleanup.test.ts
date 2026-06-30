import { afterEach, describe, expect, it, vi } from "vitest";
import { clearBrowserDataForUrl, originFromLocalhostUrl } from "./browserCleanup";

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
      origin: "http://127.0.0.1:5173"
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
});
