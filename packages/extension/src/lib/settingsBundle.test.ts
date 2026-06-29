import { describe, expect, it } from "vitest";
import { defaultSettings, type Settings } from "./settings";
import { exportSettingsBundle, importSettingsBundle } from "./settingsBundle";

const savedSettings: Settings = {
  ...defaultSettings,
  themeMode: "dark",
  includeSystemPorts: true,
  customPortRange: "3000-9999,17321",
  trustedProjectPaths: ["D:\\Projects\\ExampleShop"],
  blockedProcessNames: ["steam.exe"],
  projectProfiles: [
    {
      id: "shop",
      name: "Example Shop",
      projectPath: "D:\\Projects\\ExampleShop",
      startCommand: "pnpm dev",
      expectedPort: 5173,
      mainUrl: "http://127.0.0.1:5173",
      extraUrls: [{ label: "Admin", url: "http://127.0.0.1:5173/admin" }]
    }
  ],
  projectWorkspaces: [{ id: "daily", name: "Daily stack", profileIds: ["shop"], notes: "Release loop" }]
};

describe("settings bundle import/export", () => {
  it("exports a versioned portable settings bundle", () => {
    const bundle = JSON.parse(exportSettingsBundle(savedSettings, "2026-06-30T08:00:00.000Z")) as unknown;

    expect(bundle).toEqual({
      schema: "localhost-control-settings",
      version: 1,
      exportedAt: "2026-06-30T08:00:00.000Z",
      settings: savedSettings
    });
  });

  it("imports and sanitizes a versioned settings bundle", () => {
    const result = importSettingsBundle(
      JSON.stringify({
        schema: "localhost-control-settings",
        version: 1,
        exportedAt: "2026-06-30T08:00:00.000Z",
        settings: {
          includeSystemPorts: true,
          themeMode: "neon",
          trustedProjectPaths: ["D:\\Projects\\ExampleShop"],
          hiddenPorts: [5173, "bad"],
          projectProfiles: [
            { id: "shop", name: "Example Shop", expectedPort: 5173, mainUrl: "http://127.0.0.1:5173" },
            { id: "broken", name: "", expectedPort: 99999 }
          ],
          projectWorkspaces: [
            { id: "daily", name: "Daily stack", profileIds: ["shop", "missing"], notes: "Release loop" },
            { id: "empty", name: "Empty", profileIds: ["missing"] }
          ]
        }
      })
    );

    expect(result).toEqual({
      ok: true,
      settings: {
        ...defaultSettings,
        includeSystemPorts: true,
        trustedProjectPaths: ["D:\\Projects\\ExampleShop"],
        projectProfiles: [{ id: "shop", name: "Example Shop", expectedPort: 5173, mainUrl: "http://127.0.0.1:5173" }],
        projectWorkspaces: [{ id: "daily", name: "Daily stack", profileIds: ["shop"], notes: "Release loop" }]
      },
      summary: "Imported 1 profile and 1 workspace"
    });
  });

  it("rejects invalid JSON without producing replacement settings", () => {
    expect(importSettingsBundle("{not-json")).toEqual({
      ok: false,
      error: "Config import failed: invalid JSON"
    });
  });

  it("rejects unsupported bundle versions", () => {
    expect(importSettingsBundle(JSON.stringify({ schema: "localhost-control-settings", version: 99, settings: {} }))).toEqual({
      ok: false,
      error: "Config import failed: unsupported settings bundle"
    });
  });

  it("rejects unrelated JSON objects instead of replacing settings with defaults", () => {
    expect(importSettingsBundle(JSON.stringify({ compilerOptions: { strict: true } }))).toEqual({
      ok: false,
      error: "Config import failed: unsupported settings bundle"
    });
  });

  it("still accepts legacy raw settings exports when they contain recognizable settings keys", () => {
    expect(importSettingsBundle(JSON.stringify({ themeMode: "dark", projectProfiles: [{ id: "shop", name: "Example Shop" }] }))).toEqual({
      ok: true,
      settings: {
        ...defaultSettings,
        themeMode: "dark",
        projectProfiles: [{ id: "shop", name: "Example Shop" }]
      },
      summary: "Imported 1 profile and 0 workspaces"
    });
  });
});
