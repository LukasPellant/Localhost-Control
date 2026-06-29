import { afterEach, describe, expect, it } from "vitest";
import { defaultSettings, loadSettings, saveSettings } from "./settings";

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
        blockedProcessNames: 123,
        projectProfiles: [
          {
            id: "shop",
            name: "Example Shop",
            projectPath: "D:\\Projects\\ExampleShop",
            startCommand: "pnpm dev",
            expectedPort: 5173,
            mainUrl: "http://127.0.0.1:5173",
            extraUrls: [{ label: "Admin", url: "http://127.0.0.1:5173/admin" }],
            healthUrl: "http://127.0.0.1:5173/health",
            preferredOpenMode: "tab",
            notes: "Main storefront",
            logLines: ["ready in 400ms"]
          },
          {
            id: 123,
            name: "",
            projectPath: 456,
            expectedPort: 70000,
            extraUrls: [{ label: "Broken", url: 100 }]
          }
        ],
        projectWorkspaces: [
          { id: "daily", name: "Daily stack", profileIds: ["shop", "missing"], notes: "Open together" },
          { id: "empty", name: "Empty", profileIds: ["missing"] }
        ]
      })
    );

    await expect(loadSettings()).resolves.toEqual({
      ...defaultSettings,
      includeSystemPorts: true,
      trustedProjectPaths: ["D:\\Projects\\Safe"],
      projectProfiles: [
        {
          id: "shop",
          name: "Example Shop",
          projectPath: "D:\\Projects\\ExampleShop",
          startCommand: "pnpm dev",
          expectedPort: 5173,
          mainUrl: "http://127.0.0.1:5173",
          extraUrls: [{ label: "Admin", url: "http://127.0.0.1:5173/admin" }],
          healthUrl: "http://127.0.0.1:5173/health",
          preferredOpenMode: "tab",
          notes: "Main storefront",
          logLines: ["ready in 400ms"]
          }
        ],
      projectWorkspaces: [{ id: "daily", name: "Daily stack", profileIds: ["shop"], notes: "Open together" }]
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

  it("sanitizes settings before writing them to localStorage", async () => {
    await saveSettings({
      ...defaultSettings,
      projectProfiles: [
        { id: "shop", name: "Example Shop", mainUrl: "http://127.0.0.1:5173" },
        { id: "shop", name: "Duplicate Shop", mainUrl: "http://127.0.0.1:9999" }
      ],
      projectWorkspaces: [{ id: "daily", name: "Daily stack", profileIds: ["shop", "missing"] }]
    });

    expect(JSON.parse(window.localStorage.getItem("localhost-control-settings") ?? "{}")).toMatchObject({
      projectProfiles: [{ id: "shop", name: "Example Shop" }],
      projectWorkspaces: [{ id: "daily", profileIds: ["shop"] }]
    });
  });
});
