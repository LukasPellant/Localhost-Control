import { afterEach, describe, expect, it } from "vitest";
import { createNativeHostClient, shouldUseMockClient } from "./hostClient";

const originalUrl = window.location.href;

afterEach(() => {
  window.history.replaceState(null, "", originalUrl);
  Reflect.deleteProperty(globalThis, "chrome");
  Reflect.deleteProperty(globalThis, "browser");
});

describe("shouldUseMockClient", () => {
  it("keeps demo data disabled in production builds", () => {
    window.history.replaceState(null, "", "/sidepanel.html?mock=1");

    expect(shouldUseMockClient(false)).toBe(false);
  });

  it("allows demo data only during development", () => {
    window.history.replaceState(null, "", "/sidepanel.html?mock=1");

    expect(shouldUseMockClient(true)).toBe(true);
  });

  it("detects Firefox browser native messaging as an installed extension context", () => {
    (globalThis as { browser?: unknown }).browser = {
      runtime: {
        sendNativeMessage: async () => ({ id: "version-1", result: { version: "0.1.5", platform: "win32" } })
      }
    };

    expect(shouldUseMockClient(true)).toBe(false);
  });
});

describe("createNativeHostClient", () => {
  it("uses Firefox promise-based native messaging when the browser namespace is available", async () => {
    (globalThis as { browser?: unknown }).browser = {
      runtime: {
        sendNativeMessage: async (_hostName: string, message: { id: string; method: string }) => ({
          id: message.id,
          result: { version: "0.1.5", platform: "win32" }
        })
      }
    };

    await expect(createNativeHostClient().version()).resolves.toEqual({ version: "0.1.5", platform: "win32" });
  });
});
