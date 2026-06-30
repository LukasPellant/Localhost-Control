import { describe, expect, it } from "vitest";
import type { PortEntry } from "@localhost-control/shared";
import { formatDevContext, formatProfileContext, formatScanContext, formatWorkspaceContext } from "./devContext";
import type { PortDoctorReport } from "./portDoctor";
import type { ProfileHealthResult } from "./profileHealth";
import type { ProjectProfile } from "./projectProfiles";
import type { StaleProcessSignal } from "./staleProcesses";
import type { WorkspaceState } from "./projectWorkspaces";

const entry: PortEntry = {
  port: 5173,
  address: "127.0.0.1",
  pid: 100,
  processName: "node.exe",
  commandLine: "node vite --host 127.0.0.1",
  projectHint: "D:\\Projects\\ExampleShop",
  detectedKind: "vite",
  confidence: "high",
  killable: true,
  url: "http://127.0.0.1:5173",
  statusCode: 200,
  title: "Example Shop",
  resources: {
    cpuPercent: 12.4,
    memoryBytes: 312_000_000,
    uptimeMs: 90_000
  }
};

const profile: ProjectProfile = {
  id: "shop",
  name: "Example Shop",
  projectPath: "D:\\Projects\\ExampleShop",
  startCommand: "pnpm dev",
  healthUrl: "http://127.0.0.1:5173/health",
  logLines: ["vite ready in 420ms", "GET /health 200"]
};

const profileHealth: ProfileHealthResult = {
  profileId: "shop",
  state: "healthy",
  label: "Healthy 204",
  checkedAt: "2026-06-30T10:00:00.000Z",
  message: "Example Shop health check passed (204)"
};

const doctorReport: PortDoctorReport = {
  status: "conflict",
  summary: "2 listeners share port 5173",
  issues: ["PID 101 also listens on port 5173"],
  advice: ["Stop PID 101 or move one app to port 5175."],
  conflictingEntries: [],
  nextFreePort: 5175
};

const staleSignal: StaleProcessSignal = {
  severity: "medium",
  label: "Possible stale process",
  reasons: ["Long uptime", "High memory"],
  advice: ["If this listener is unexpected, review and stop it safely, then refresh the scan."]
};

describe("formatDevContext", () => {
  it("formats the current visible scan as a redacted diagnostics snapshot", () => {
    const text = formatScanContext({
      totalCount: 3,
      filterLabel: "Dev apps",
      query: "shop",
      scannedAt: "2026-06-30T10:00:00.000Z",
      entries: [
        {
          entry: {
            ...entry,
            commandLine: "node vite --token hunter2",
            url: "http://127.0.0.1:5173?token=hunter2"
          },
          profile,
          profileHealth,
          staleSignal
        }
      ]
    });

    expect(text).toContain("# Localhost Control scan context");
    expect(text).toContain("- Visible ports: 1/3");
    expect(text).toContain("- Filter: Dev apps");
    expect(text).toContain("- Search: shop");
    expect(text).toContain("- Scanned at: 2026-06-30T10:00:00.000Z");
    expect(text).toContain("## Ports");
    expect(text).toContain("- Example Shop: port 5173 / PID 100 / node.exe / Vite / high / HTTP 200 / http://127.0.0.1:5173/?token=[redacted] / 12.4% CPU / 298 MB RAM / 2 min uptime");
    expect(text).toContain("  - Project path: D:\\Projects\\ExampleShop");
    expect(text).toContain("  - Command: node vite --token [redacted]");
    expect(text).toContain("  - Health: Healthy 204");
    expect(text).toContain("  - Signal: Possible stale process / Long uptime / High memory");
    expect(text).not.toContain("hunter2");
  });

  it("formats an empty visible scan without throwing", () => {
    expect(formatScanContext({ entries: [], totalCount: 0, filterLabel: "Dev apps" })).toContain("- No visible localhost ports");
  });

  it("formats a saved profile context even when the profile is stopped", () => {
    const text = formatProfileContext({
      profile: {
        ...profile,
        startCommand: "pnpm dev --token hunter2",
        mainUrl: "http://127.0.0.1:5173?token=hunter2",
        healthUrl: "http://127.0.0.1:5173/health?access_token=hunter2",
        expectedPort: 5173,
        notes: "Release smoke"
      },
      status: "stopped",
      healthLabel: "No running port"
    });

    expect(text).toContain("# Localhost Control profile context");
    expect(text).toContain("- Profile: Example Shop");
    expect(text).toContain("- Status: stopped");
    expect(text).toContain("- Health: No running port");
    expect(text).toContain("- Expected port: 5173");
    expect(text).toContain("- Main URL: http://127.0.0.1:5173/?token=[redacted]");
    expect(text).toContain("- Health URL: http://127.0.0.1:5173/health?access_token=[redacted]");
    expect(text).toContain("- Start command: pnpm dev --token [redacted]");
    expect(text).toContain("- Notes: Release smoke");
    expect(text).not.toContain("hunter2");
  });

  it("formats selected localhost app context for AI/coding agents", () => {
    expect(formatDevContext({ entry, profile, profileHealth, doctorReport, staleSignal })).toBe(`# Localhost Control dev context

- Project: Example Shop
- URL: http://127.0.0.1:5173
- Origin: http://127.0.0.1:5173
- Port: 5173
- PID: 100
- Process: node.exe
- Kind: vite
- Confidence: high
- HTTP status: 200
- Project path: D:\\Projects\\ExampleShop
- Process command: node vite --host 127.0.0.1
- Saved start command: pnpm dev
- Resources: 12.4% CPU / 298 MB RAM / 2 min uptime
- Health: Healthy 204
- Health URL: http://127.0.0.1:5173/health
- Doctor: 2 listeners share port 5173 / Next free: 5175 / PID 101 also listens on port 5173
- Stale signal: Possible stale process / Long uptime / High memory / Advice: If this listener is unexpected, review and stop it safely, then refresh the scan.
- Recent profile logs (untrusted diagnostics):
  - vite ready in 420ms
  - GET /health 200`);
  });

  it("formats workspace context with redacted service URLs and logs", () => {
    const workspaceState: WorkspaceState = {
      workspace: { id: "daily", name: "Daily stack", profileIds: ["shop", "api"], notes: "Release loop" },
      status: "degraded",
      runningCount: 1,
      attentionCount: 1,
      totalCount: 2,
      healthLabel: "1 running, 1 needs attention",
      openUrls: ["http://127.0.0.1:5173?token=hunter2", "http://127.0.0.1:17321/docs"],
      profileStates: [
        {
          profile: {
            ...profile,
            logLines: ["Authorization: Bearer abc123", "ready"]
          },
          status: "running",
          healthLabel: "Healthy 204",
          entry: {
            ...entry,
            url: "http://127.0.0.1:5173?token=hunter2",
            commandLine: "node vite --token hunter2"
          }
        },
        {
          profile: {
            id: "api",
            name: "API",
            mainUrl: "http://127.0.0.1:17321",
            healthUrl: "http://127.0.0.1:17321/health?access_token=hunter2"
          },
          status: "stopped",
          healthLabel: "No running port"
        }
      ]
    };

    const text = formatWorkspaceContext(workspaceState);

    expect(text).toContain("# Localhost Control workspace context");
    expect(text).toContain("- Workspace: Daily stack");
    expect(text).toContain("- Status: degraded");
    expect(text).toContain("- Health: 1 running, 1 needs attention");
    expect(text).toContain("- Notes: Release loop");
    expect(text).toContain("- Open URLs:");
    expect(text).toContain("  - http://127.0.0.1:5173/?token=[redacted]");
    expect(text).toContain("## Services");
    expect(text).toContain("- Example Shop: running / Healthy 204 / PID 100 / http://127.0.0.1:5173/?token=[redacted]");
    expect(text).toContain("  - Command: node vite --token [redacted]");
    expect(text).toContain("  - Log: Authorization: Bearer [redacted]");
    expect(text).toContain("- API: stopped / No running port / http://127.0.0.1:17321");
    expect(text).toContain("  - Health URL: http://127.0.0.1:17321/health?access_token=[redacted]");
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("abc123");
  });

  it("limits copied profile logs to the latest four lines", () => {
    expect(
      formatDevContext({
        entry,
        profile: {
          ...profile,
          logLines: ["line 1", "line 2", "line 3", "line 4", "line 5"]
        }
      })
    ).toContain(`- Recent profile logs (untrusted diagnostics):
  - line 2
  - line 3
  - line 4
  - line 5`);
  });

  it("redacts common prompt-copy secrets from commands, URLs, paths, and logs", () => {
    const text = formatDevContext({
      entry: {
        ...entry,
        commandLine: "node vite --token hunter2 OPENAI_API_KEY=sk-local DATABASE_URL=postgres://user:pass@host/db",
        projectHint: "C:\\Users\\pella\\Projects\\ExampleShop",
        url: "http://127.0.0.1:5173/app?token=hunter2&mode=dev#debug"
      },
      profile: {
        ...profile,
        projectPath: "C:\\Users\\pella\\Projects\\ExampleShop",
        startCommand: "pnpm dev --api-key sk-local",
        healthUrl: "http://127.0.0.1:5173/health?access_token=hunter2&mode=ready",
        logLines: ["\u001b[31mAuthorization: Bearer abc123\u001b[0m", "ready"]
      }
    });

    expect(text).toContain("C:\\Users\\[user]\\Projects\\ExampleShop");
    expect(text).toContain("--token [redacted]");
    expect(text).toContain("OPENAI_API_KEY=[redacted]");
    expect(text).toContain("DATABASE_URL=[redacted]");
    expect(text).toContain("--api-key [redacted]");
    expect(text).toContain("token=[redacted]&mode=dev");
    expect(text).toContain("access_token=[redacted]&mode=ready");
    expect(text).toContain("Authorization: Bearer [redacted]");
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("sk-local");
    expect(text).not.toContain("abc123");
    expect(text).not.toContain("pella");
    expect(text).not.toContain("\u001b");
  });
});
