import { describe, expect, it } from "vitest";
import { canonicalizeProfileStartCommand, patchStartCommandPort, retargetProfilePort, preferredProfilePort, type ProjectProfile } from "./startPorts";

describe("start port preparation", () => {
  it("replaces explicit long-form port flags in saved commands", () => {
    expect(patchStartCommandPort("vite --host 127.0.0.1 --port 5173", 5173, 5174)).toEqual({
      ok: true,
      commandLine: "vite --host 127.0.0.1 --port 5174",
      changed: true
    });
    expect(patchStartCommandPort("vite --port=5173 --host 127.0.0.1", 5173, 5174)).toEqual({
      ok: true,
      commandLine: "vite --port=5174 --host 127.0.0.1",
      changed: true
    });
  });

  it("replaces short port flags in saved commands", () => {
    expect(patchStartCommandPort("next dev -p 3000", 3000, 3001)).toEqual({
      ok: true,
      commandLine: "next dev -p 3001",
      changed: true
    });
    expect(patchStartCommandPort("next dev -p=3000", 3000, 3001)).toEqual({
      ok: true,
      commandLine: "next dev -p=3001",
      changed: true
    });
  });

  it("adds port flags for known direct dev server commands", () => {
    expect(patchStartCommandPort("vite --host 127.0.0.1", 5173, 5174)).toEqual({
      ok: true,
      commandLine: "vite --host 127.0.0.1 --port 5174",
      changed: true
    });
    expect(patchStartCommandPort("next dev", 3000, 3001)).toEqual({
      ok: true,
      commandLine: "next dev --port 3001",
      changed: true
    });
  });

  it("adds package-manager passthrough port flags for dev scripts", () => {
    expect(patchStartCommandPort("pnpm dev", 5173, 5174)).toEqual({
      ok: true,
      commandLine: "pnpm dev -- --port 5174",
      changed: true
    });
    expect(patchStartCommandPort("npm run dev", 5173, 5174)).toEqual({
      ok: true,
      commandLine: "npm run dev -- --port 5174",
      changed: true
    });
  });

  it("rejects unknown commands when the port must change", () => {
    expect(patchStartCommandPort("node server.js", 5173, 5174)).toEqual({
      ok: false,
      message: "Port 5173 is busy and this command cannot be safely retargeted."
    });
  });

  it("updates a local profile command and URLs for a selected clean port", () => {
    const profile: ProjectProfile = {
      id: "kerfcut",
      name: "KerfCut",
      projectPath: "D:\\DevelopmentD\\DarkBurn",
      startCommand: "vite --host 127.0.0.1 --port 5173",
      expectedPort: 5173,
      mainUrl: "http://127.0.0.1:5173",
      healthUrl: "http://127.0.0.1:5173/health",
      extraUrls: [{ label: "Admin", url: "http://127.0.0.1:5173/admin" }]
    };

    expect(retargetProfilePort(profile, 5173, 5174)).toEqual({
      ok: true,
      profile: {
        ...profile,
        startCommand: "vite --host 127.0.0.1 --port 5174",
        expectedPort: 5174,
        mainUrl: "http://127.0.0.1:5174",
        healthUrl: "http://127.0.0.1:5174/health",
        extraUrls: [{ label: "Admin", url: "http://127.0.0.1:5174/admin" }]
      },
      changed: true
    });
  });

  it("derives the preferred start port from profile metadata", () => {
    expect(preferredProfilePort({ id: "a", name: "A", expectedPort: 4321 })).toBe(4321);
    expect(preferredProfilePort({ id: "b", name: "B", mainUrl: "http://127.0.0.1:5173" })).toBe(5173);
    expect(preferredProfilePort({ id: "c", name: "C", healthUrl: "http://127.0.0.1:8788/health" })).toBe(8788);
  });

  it("prefers the explicit command port over stale saved metadata", () => {
    expect(
      preferredProfilePort({
        id: "kerfcut",
        name: "KerfCut",
        startCommand: '"node" "D:\\DevelopmentD\\DarkBurn\\node_modules\\.bin\\..\\vite\\bin\\vite.js" --host 127.0.0.1 --port 5173',
        expectedPort: 5174,
        mainUrl: "http://127.0.0.1:5174"
      })
    ).toBe(5173);
    expect(preferredProfilePort({ id: "next", name: "Next", startCommand: "next dev -p=3000", expectedPort: 3001 })).toBe(3000);
  });

  it("canonicalizes KerfCut local Vite binary commands to the real web app dev script", () => {
    const profile: ProjectProfile = {
      id: "kerfcut",
      name: "KerfCut",
      projectPath: "D:\\DevelopmentD\\DarkBurn",
      startCommand: '"node" "D:\\DevelopmentD\\DarkBurn\\node_modules\\.bin\\\\..\\vite\\bin\\vite.js" --host 127.0.0.1 --port 5173',
      expectedPort: 5173,
      mainUrl: "http://127.0.0.1:5173"
    };

    expect(canonicalizeProfileStartCommand(profile)).toEqual({
      ok: true,
      profile: { ...profile, projectPath: "D:\\DevelopmentD\\DarkBurn\\apps\\web", startCommand: "npm run dev" },
      changed: true
    });
  });
});
