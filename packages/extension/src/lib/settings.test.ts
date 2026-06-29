import { afterEach, describe, expect, it } from "vitest";
import { defaultSettings, loadSettings } from "./settings";

afterEach(() => {
  window.localStorage.clear();
  Reflect.deleteProperty(globalThis, "chrome");
  Reflect.deleteProperty(globalThis, "browser");
});

describe("loadSettings", () => {
  it("falls back to defaults when localStorage contains invalid JSON", async () => {
    window.localStorage.setItem("localhost-control-settings", "{invalid-json");

    await expect(loadSettings()).resolves.toEqual(defaultSettings);
  });

  it("sanitizes malformed saved settings while preserving valid values", async () => {
    window.localStorage.setItem(
      "localhost-control-settings",
      JSON.stringify({
        includeSystemPorts: true,
        httpProbe: "yes",
        refreshIntervalSec: "fast",
        themeMode: "neon",
        hiddenPorts: ["5173"],
        customPortRange: 3000,
        trustedProjectRoots: "/work",
        trustedProjectPaths: ["D:\\Projects\\Safe"],
        blockedProcessNames: 123
      })
    );

    await expect(loadSettings()).resolves.toEqual({
      ...defaultSettings,
      includeSystemPorts: true,
      trustedProjectPaths: ["D:\\Projects\\Safe"]
    });
  });

  it("falls back to defaults when extension storage cannot be read", async () => {
    (globalThis as { browser?: unknown }).browser = {
      storage: {
        local: {
          get: async () => {
            throw new Error("storage unavailable");
          },
          set: async () => undefined
        }
      }
    };

    await expect(loadSettings()).resolves.toEqual(defaultSettings);
  });
});
