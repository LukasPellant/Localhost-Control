import { describe, expect, it } from "vitest";
import { defaultSettings, type Settings } from "./settings";
import {
  removeProjectProfile,
  removeProjectWorkspace,
  removeTrustedProjectRoot,
  removeTrustedProjectPath,
  clearActionAudit,
  unblockProcessName,
  unhidePort,
  upsertProjectProfile
} from "./settingsActions";

const settings: Settings = {
  ...defaultSettings,
  hiddenPorts: [5173, 17321],
  trustedProjectPaths: ["D:\\Projects\\ExampleShop", "C:\\Workspaces\\LocalApi"],
  trustedProjectRoots: ["D:\\DevelopmentD"],
  blockedProcessNames: ["steam.exe", "preview-service.exe"],
  projectProfiles: [
    { id: "shop", name: "Example Shop", expectedPort: 5173, mainUrl: "http://127.0.0.1:5173" },
    { id: "api", name: "Local API", expectedPort: 17321, mainUrl: "http://127.0.0.1:17321" },
    { id: "docs", name: "Docs", expectedPort: 4321, mainUrl: "http://127.0.0.1:4321" }
  ],
  projectWorkspaces: [
    { id: "daily", name: "Daily stack", profileIds: ["shop", "api"] },
    { id: "docs-only", name: "Docs only", profileIds: ["docs"] }
  ],
  actionAudit: [{ id: "start-shop", action: "start-profile", target: "Example Shop", createdAt: "2026-06-30T08:00:00.000Z" }]
};

describe("settings actions", () => {
  it("upserts a sanitized project profile without disturbing workspaces", () => {
    expect(
      upsertProjectProfile(settings, {
        id: "api",
        name: "Local API Updated",
        projectPath: "C:\\Workspaces\\LocalApi",
        startCommand: "pnpm dev",
        expectedPort: 17322,
        mainUrl: "http://127.0.0.1:17322/",
        healthUrl: "http://127.0.0.1:17322/health",
        preferredOpenMode: "window",
        extraUrls: [
          { label: "Metrics", url: "http://127.0.0.1:17322/metrics" },
          { label: "Production", url: "https://example.com" }
        ],
        notes: "Runs the local API"
      })
    ).toMatchObject({
      projectProfiles: [
        { id: "shop", name: "Example Shop" },
        {
          id: "api",
          name: "Local API Updated",
          projectPath: "C:\\Workspaces\\LocalApi",
          startCommand: "pnpm dev",
          expectedPort: 17322,
          mainUrl: "http://127.0.0.1:17322/",
          healthUrl: "http://127.0.0.1:17322/health",
          preferredOpenMode: "window",
          extraUrls: [{ label: "Metrics", url: "http://127.0.0.1:17322/metrics" }],
          notes: "Runs the local API"
        },
        { id: "docs", name: "Docs" }
      ],
      projectWorkspaces: [
        { id: "daily", profileIds: ["shop", "api"] },
        { id: "docs-only", profileIds: ["docs"] }
      ]
    });
  });

  it("adds a new sanitized project profile", () => {
    expect(
      upsertProjectProfile(settings, {
        id: "tools",
        name: "Tools",
        expectedPort: 7331,
        mainUrl: "http://tools.localhost:7331"
      }).projectProfiles
    ).toEqual([
      ...settings.projectProfiles,
      {
        id: "tools",
        name: "Tools",
        expectedPort: 7331,
        mainUrl: "http://tools.localhost:7331"
      }
    ]);
  });

  it("removes a project profile and prunes dependent workspaces", () => {
    expect(removeProjectProfile(settings, "api")).toMatchObject({
      projectProfiles: [
        { id: "shop", name: "Example Shop" },
        { id: "docs", name: "Docs" }
      ],
      projectWorkspaces: [
        { id: "daily", profileIds: ["shop"] },
        { id: "docs-only", profileIds: ["docs"] }
      ]
    });
  });

  it("drops workspaces left empty by profile removal", () => {
    expect(removeProjectProfile(settings, "docs")).toMatchObject({
      projectProfiles: [
        { id: "shop", name: "Example Shop" },
        { id: "api", name: "Local API" }
      ],
      projectWorkspaces: [{ id: "daily", profileIds: ["shop", "api"] }]
    });
  });

  it("removes saved workspaces, trusted paths, hidden ports, and blocked process names", () => {
    expect(removeProjectWorkspace(settings, "daily").projectWorkspaces).toEqual([{ id: "docs-only", name: "Docs only", profileIds: ["docs"] }]);
    expect(removeTrustedProjectPath(settings, "d:/projects/exampleshop").trustedProjectPaths).toEqual(["C:\\Workspaces\\LocalApi"]);
    expect(removeTrustedProjectRoot(settings, "d:/developmentd").trustedProjectRoots).toEqual([]);
    expect(unhidePort(settings, 5173).hiddenPorts).toEqual([17321]);
    expect(unblockProcessName(settings, "PREVIEW-SERVICE.EXE").blockedProcessNames).toEqual(["steam.exe"]);
    expect(clearActionAudit(settings).actionAudit).toEqual([]);
  });

  it("removes trusted roots and paths independently when they share a value", () => {
    const duplicateTrustSettings: Settings = {
      ...settings,
      trustedProjectRoots: ["D:\\DevelopmentD"],
      trustedProjectPaths: ["D:\\DevelopmentD"]
    };

    expect(removeTrustedProjectRoot(duplicateTrustSettings, "D:\\DevelopmentD")).toMatchObject({
      trustedProjectRoots: [],
      trustedProjectPaths: ["D:\\DevelopmentD"]
    });
    expect(removeTrustedProjectPath(duplicateTrustSettings, "D:\\DevelopmentD")).toMatchObject({
      trustedProjectRoots: ["D:\\DevelopmentD"],
      trustedProjectPaths: []
    });
  });
});
