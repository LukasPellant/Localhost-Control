import { describe, expect, it } from "vitest";
import type { PortEntry } from "@localhost-control/shared";
import { deriveProfileStates, matchProfileForEntry, type ProjectProfile } from "./projectProfiles";

const viteEntry: PortEntry = {
  port: 5173,
  address: "127.0.0.1",
  pid: 100,
  processName: "node.exe",
  commandLine: "node vite",
  projectHint: "D:\\Projects\\ExampleShop",
  detectedKind: "vite",
  confidence: "high",
  killable: true,
  url: "http://127.0.0.1:5173",
  statusCode: 200,
  title: "Example Shop"
};
const { projectHint: _viteProjectHint, ...viteEntryWithoutPath } = viteEntry;

describe("project profile matching", () => {
  it("prefers a profile whose project path contains the scanned project hint", () => {
    const profiles: ProjectProfile[] = [
      { id: "docs", name: "Docs", projectPath: "D:\\Projects\\DocsPreview", expectedPort: 5173, mainUrl: "http://127.0.0.1:5173" },
      { id: "shop", name: "Example Shop", projectPath: "D:\\Projects\\ExampleShop", expectedPort: 3000 }
    ];

    expect(matchProfileForEntry(viteEntry, profiles)?.profile.id).toBe("shop");
  });

  it("falls back to port and URL matching when the project path is unavailable", () => {
    const profiles: ProjectProfile[] = [
      { id: "api", name: "API", expectedPort: 17321, mainUrl: "http://127.0.0.1:17321" },
      { id: "shop", name: "Example Shop", expectedPort: 5173, mainUrl: "http://127.0.0.1:5173" }
    ];

    expect(matchProfileForEntry(viteEntryWithoutPath, profiles)?.profile.name).toBe("Example Shop");
  });

  it("marks saved profiles as running, starting, unhealthy, or stopped from current scan results", () => {
    const profiles: ProjectProfile[] = [
      { id: "shop", name: "Example Shop", projectPath: "D:\\Projects\\ExampleShop", healthUrl: "http://127.0.0.1:5173/health" },
      { id: "broken", name: "Broken API", expectedPort: 17321, healthUrl: "http://127.0.0.1:17321/health" },
      { id: "docs", name: "Docs", expectedPort: 4321 }
    ];

    const states = deriveProfileStates(profiles, [
      viteEntry,
      { ...viteEntryWithoutPath, pid: 200, port: 17321, url: "http://127.0.0.1:17321", statusCode: 503, title: "Unavailable" }
    ]);

    expect(states.map((state) => [state.profile.id, state.status])).toEqual([
      ["shop", "running"],
      ["broken", "unhealthy"],
      ["docs", "stopped"]
    ]);
    expect(states[0]?.entry?.pid).toBe(100);
    expect(states[0]?.healthLabel).toBe("Observed HTTP 200");
    expect(states[2]?.healthLabel).toBe("No running port");
  });
});
