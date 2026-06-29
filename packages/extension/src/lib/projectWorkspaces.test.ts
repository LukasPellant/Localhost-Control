import { describe, expect, it } from "vitest";
import type { PortEntry } from "@localhost-control/shared";
import { deriveProfileStates, type ProjectProfile } from "./projectProfiles";
import { deriveWorkspaceStates, sanitizeProjectWorkspaces, type ProjectWorkspace } from "./projectWorkspaces";

const profiles: ProjectProfile[] = [
  { id: "shop", name: "Example Shop", projectPath: "D:\\Projects\\ExampleShop", expectedPort: 5173, mainUrl: "http://127.0.0.1:5173" },
  { id: "api", name: "Local API", expectedPort: 17321, mainUrl: "http://127.0.0.1:17321" },
  { id: "docs", name: "Docs", expectedPort: 4321, mainUrl: "http://127.0.0.1:4321" }
];

const runningEntries: PortEntry[] = [
  {
    port: 5173,
    address: "127.0.0.1",
    pid: 100,
    processName: "node.exe",
    detectedKind: "vite",
    confidence: "high",
    killable: true,
    projectHint: "D:\\Projects\\ExampleShop",
    url: "http://127.0.0.1:5173",
    statusCode: 200
  },
  {
    port: 17321,
    address: "127.0.0.1",
    pid: 200,
    processName: "node.exe",
    detectedKind: "node",
    confidence: "medium",
    killable: true,
    url: "http://127.0.0.1:17321",
    statusCode: 503
  }
];

describe("project workspaces", () => {
  it("sanitizes workspace membership against known profiles", () => {
    const workspaces = sanitizeProjectWorkspaces(
      [
        { id: "daily", name: "Daily stack", profileIds: ["shop", "missing", "api", "shop"], notes: "Main dev loop" },
        { id: "daily", name: "Duplicate daily", profileIds: ["docs"] },
        { id: "empty", name: "Empty", profileIds: ["missing"] },
        { id: 123, name: "Broken", profileIds: ["shop"] }
      ],
      profiles
    );

    expect(workspaces).toEqual<ProjectWorkspace[]>([
      { id: "daily", name: "Daily stack", profileIds: ["shop", "api"], notes: "Main dev loop" }
    ]);
  });

  it("derives workspace health, next actions, and openable URLs from profile states", () => {
    const states = deriveProfileStates(profiles, runningEntries);
    const workspaceStates = deriveWorkspaceStates([{ id: "daily", name: "Daily stack", profileIds: ["shop", "api", "docs"] }], profiles, states);

    expect(workspaceStates).toEqual([
      {
        workspace: { id: "daily", name: "Daily stack", profileIds: ["shop", "api", "docs"] },
        status: "degraded",
        runningCount: 1,
        attentionCount: 2,
        totalCount: 3,
        healthLabel: "1 running, 2 need attention",
        openUrls: ["http://127.0.0.1:5173", "http://127.0.0.1:17321", "http://127.0.0.1:4321"],
        profileStates: states
      }
    ]);
  });
});
