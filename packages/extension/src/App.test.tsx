import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { HostClient } from "./lib/hostClient";
import type { KillResult, PortEntry } from "@localhost-control/shared";

const entries: PortEntry[] = [
  {
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
    title: "Example Shop",
    resources: {
      cpuPercent: 12.4,
      memoryBytes: 312_000_000,
      privateMemoryBytes: 188_000_000,
      threadCount: 22,
      handleCount: 240,
      uptimeMs: 90_000
    }
  },
  {
    port: 17321,
    address: "127.0.0.1",
    pid: 150,
    processName: "node.exe",
    commandLine: "node api-server.js --watch",
    projectHint: "C:\\Workspaces\\LocalApi",
    detectedKind: "node",
    confidence: "medium",
    killable: true,
    url: "http://127.0.0.1:17321",
    statusCode: 200,
    title: "Local API"
  },
  {
    port: 6463,
    address: "127.0.0.1",
    pid: 250,
    processName: "ChatClient.exe",
    commandLine: "chat client local listener",
    projectHint: "C:\\Program Files\\ChatClient",
    detectedKind: "node",
    confidence: "medium",
    killable: true,
    url: "http://127.0.0.1:6463",
    statusCode: 200,
    title: "Chat Client"
  },
  {
    port: 3515,
    address: "127.0.0.1",
    pid: 200,
    processName: "steam.exe",
    commandLine: "steam service",
    projectHint: "C:\\Program Files (x86)\\Steam",
    detectedKind: "static",
    confidence: "medium",
    killable: true,
    url: "http://127.0.0.1:3515",
    statusCode: 404,
    title: "404 Not Found"
  },
  {
    port: 5181,
    address: "127.0.0.1",
    pid: 300,
    processName: "python.exe",
    commandLine: "python -m http.server 5181 --bind 127.0.0.1",
    projectHint: "D:\\Projects\\DocsPreview",
    detectedKind: "python",
    confidence: "high",
    killable: true,
    url: "http://127.0.0.1:5181",
    statusCode: 200,
    title: "Docs Preview"
  },
  {
    port: 135,
    address: "0.0.0.0",
    pid: 4,
    processName: "System",
    detectedKind: "unknown",
    confidence: "low",
    killable: false,
    protectionReason: "Protected system process"
  }
];

const client: HostClient = {
  scan: vi.fn(async () => ({
    scannedAt: "2026-06-27T10:00:00.000Z",
    durationMs: 22,
    entries
  })),
  kill: vi.fn(async () => ({ killed: true, pid: 100, port: 5173, portClosed: true, message: "Killed 100" })),
  openTerminal: vi.fn(async () => ({ opened: true, message: "Opened" })),
  version: vi.fn(async () => ({ version: "0.1.5", platform: "win32" }))
};

describe("App", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    delete (globalThis as { chrome?: unknown }).chrome;
    delete (globalThis as { browser?: unknown }).browser;
    Reflect.deleteProperty(navigator, "clipboard");
    document.execCommand = undefined as unknown as typeof document.execCommand;
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-theme-mode");
  });

  it("defaults to dev web apps and excludes non-dev static services", async () => {
    render(<App client={client} />);

    expect(await screen.findByRole("button", { name: /select port 5173/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /select port 5181/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /select port 17321/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /select port 6463/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /select port 3515/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /select port 135/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dev apps" })).toHaveClass("active");
  });

  it("renders scan results, selects a row, and calls kill for a killable dev server", async () => {
    render(<App client={client} />);

    expect(await screen.findByText("Localhost Control")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /select port 5173/i })).toBeInTheDocument();
    expect(screen.getByText("Example Shop")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /select port 5173/i }));
    expect(screen.getByText("node vite")).toBeInTheDocument();
    expect(screen.getAllByText("12.4% CPU").length).toBeGreaterThan(0);
    expect(screen.getAllByText("298 MB RAM").length).toBeGreaterThan(0);
    expect(screen.getByText("179 MB private")).toBeInTheDocument();
    expect(screen.getByText("22 threads")).toBeInTheDocument();

    fireEvent.click(within(screen.getByLabelText("Detected localhost ports")).getByRole("button", { name: /kill port 5173/i }));
    expect(client.kill).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: /stop example shop/i });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("node vite")).toBeInTheDocument();
    expect(within(dialog).getAllByText("D:\\Projects\\ExampleShop").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /force stop/i }));

    await waitFor(() => expect(client.kill).toHaveBeenCalledWith({ pid: 100, port: 5173, mode: "force-tree" }));
    expect(await screen.findByText(/Killed 100/i)).toBeInTheDocument();
  });

  it("keeps keyboard focus inside the destructive stop confirmation", async () => {
    render(<App client={client} />);

    expect(await screen.findByRole("button", { name: /select port 5173/i })).toBeInTheDocument();
    const killButton = within(screen.getByLabelText("Detected localhost ports")).getByRole("button", { name: /kill port 5173/i });
    killButton.focus();
    fireEvent.click(killButton);

    const dialog = screen.getByRole("dialog", { name: /stop example shop/i });
    const cancelButton = within(dialog).getByRole("button", { name: /cancel/i });
    const forceStopButton = within(dialog).getByRole("button", { name: /force stop/i });
    expect(cancelButton).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(forceStopButton).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(cancelButton).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: /stop example shop/i })).not.toBeInTheDocument();
    expect(killButton).toHaveFocus();
  });

  it("shows saved project profiles as the primary command-center entities", async () => {
    window.localStorage.setItem(
      "localhost-control-settings",
      JSON.stringify({
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
            notes: "Storefront and checkout",
            logLines: ["vite ready in 420ms", "WARN deprecated env", "ERROR failed checkout", "Authorization: Bearer abc123"]
          },
          {
            id: "docs",
            name: "Docs",
            expectedPort: 4321,
            mainUrl: "http://127.0.0.1:4321"
          }
        ]
      })
    );

    render(<App client={client} />);

    const profiles = await screen.findByLabelText("Project profiles");
    expect(within(profiles).getByText("Example Shop")).toBeInTheDocument();
    expect(within(profiles).getByText("running")).toBeInTheDocument();
    expect(within(profiles).getByText("Observed HTTP 200")).toBeInTheDocument();
    expect(within(profiles).getByText("Docs")).toBeInTheDocument();
    expect(within(profiles).getByText("stopped")).toBeInTheDocument();

    expect(await screen.findByRole("button", { name: /select port 5173/i })).toHaveTextContent("Example Shop");
    expect(screen.getByLabelText("Port 5173 details")).toHaveTextContent("Storefront and checkout");
    expect(screen.getByLabelText("Port 5173 details")).toHaveTextContent("vite ready in 420ms");
  });

  it("starts a stopped project profile with a saved project path and command", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    window.localStorage.setItem(
      "localhost-control-settings",
      JSON.stringify({
        trustedProjectRoots: ["D:\\Projects"],
        projectProfiles: [
          {
            id: "docs",
            name: "Docs",
            projectPath: "D:\\Projects\\ManualDocs",
            startCommand: "pnpm docs",
            expectedPort: 4321,
            mainUrl: "http://127.0.0.1:4321"
          }
        ]
      })
    );

    render(<App client={client} />);

    const profiles = await screen.findByLabelText("Project profiles");
    fireEvent.click(within(profiles).getByRole("button", { name: /start profile docs/i }));

    await waitFor(() =>
      expect(client.openTerminal).toHaveBeenCalledWith({
        projectHint: "D:\\Projects\\ManualDocs",
        commandLine: "pnpm docs",
        executeCommand: true
      })
    );
    expect(openSpy).not.toHaveBeenCalledWith("http://127.0.0.1:4321", "_blank", "noopener,noreferrer");
    expect(await screen.findByText("Started profile Docs")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /manage settings/i }));
    const manager = await screen.findByLabelText("Settings manager");
    expect(manager).toHaveTextContent("Recent Actions");
    expect(manager).toHaveTextContent("Docs");
    expect(manager).toHaveTextContent("Started profile");
  });

  it("waits for started profile health and reports when it becomes ready", async () => {
    let failFirstCheck: ((error: Error) => void) | undefined;
    const fetchHealth = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            failFirstCheck = reject;
          })
      )
      .mockResolvedValueOnce({ ok: true, status: 204, statusText: "No Content" });
    vi.stubGlobal("fetch", fetchHealth);
    window.localStorage.setItem(
      "localhost-control-settings",
      JSON.stringify({
        trustedProjectRoots: ["D:\\Projects"],
        projectProfiles: [
          {
            id: "docs",
            name: "Docs",
            projectPath: "D:\\Projects\\ManualDocs",
            startCommand: "pnpm docs",
            expectedPort: 4321,
            mainUrl: "http://127.0.0.1:4321",
            healthUrl: "http://127.0.0.1:4321/health"
          }
        ]
      })
    );

    render(<App client={client} />);

    const profiles = await screen.findByLabelText("Project profiles");
    fireEvent.click(within(profiles).getByRole("button", { name: /start profile docs/i }));

    expect(await screen.findByText("Waiting for Docs health check...")).toBeInTheDocument();
    expect(profiles).toHaveTextContent("starting");
    expect(profiles).toHaveTextContent("Waiting for health");
    await waitFor(() => expect(fetchHealth).toHaveBeenCalledTimes(1));
    failFirstCheck?.(new Error("not ready"));

    await waitFor(() => expect(fetchHealth).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(await screen.findByText("Docs is ready (204)")).toBeInTheDocument();
    expect(profiles).toHaveTextContent("running");
    expect(profiles).toHaveTextContent("Healthy 204");
  });

  it("does not offer profile start when the saved command is not safe to run", async () => {
    window.localStorage.setItem(
      "localhost-control-settings",
      JSON.stringify({
        projectProfiles: [
          {
            id: "docs",
            name: "Docs",
            projectPath: "D:\\Projects\\ManualDocs",
            startCommand: "pnpm docs",
            expectedPort: 4321,
            mainUrl: "http://127.0.0.1:4321"
          }
        ]
      })
    );

    render(<App client={client} />);

    const profiles = await screen.findByLabelText("Project profiles");
    expect(within(profiles).queryByRole("button", { name: /start profile docs/i })).not.toBeInTheDocument();
  });

  it("groups saved profile health, origin cleanup, command, URLs, and recent logs in the detail card", async () => {
    window.localStorage.setItem(
      "localhost-control-settings",
      JSON.stringify({
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
            notes: "Storefront and checkout",
            logLines: ["vite ready in 420ms", "WARN deprecated env", "ERROR failed checkout", "Authorization: Bearer abc123"]
          }
        ]
      })
    );

    render(<App client={client} />);

    const details = await screen.findByLabelText("Port 5173 details");
    const devHealth = within(details).getByLabelText("Dev health for Example Shop");

    expect(devHealth).toHaveTextContent("Example Shop");
    expect(devHealth).toHaveTextContent("Health URL");
    expect(devHealth).toHaveTextContent("http://127.0.0.1:5173/health");
    expect(devHealth).toHaveTextContent("Origin");
    expect(devHealth).toHaveTextContent("http://127.0.0.1:5173");
    expect(devHealth).toHaveTextContent("Saved command");
    expect(devHealth).toHaveTextContent("pnpm dev");
    expect(devHealth).toHaveTextContent("Recent profile logs");
    expect(within(devHealth).getByText("WARN deprecated env")).toHaveClass("warning");
    expect(within(devHealth).getByText("ERROR failed checkout")).toHaveClass("error");
    expect(devHealth).toHaveTextContent("Authorization: Bearer [redacted]");
    expect(devHealth).not.toHaveTextContent("abc123");
    expect(within(devHealth).getByRole("link", { name: "Admin" })).toHaveAttribute("href", "http://127.0.0.1:5173/admin");
    expect(within(devHealth).getByRole("button", { name: /clean app origin http:\/\/127\.0\.0\.1:5173/i })).toBeInTheDocument();
    expect(within(devHealth).getByRole("button", { name: /copy logs for example shop/i })).toBeInTheDocument();
  });

  it("copies sanitized recent profile logs from the detail card", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    window.localStorage.setItem(
      "localhost-control-settings",
      JSON.stringify({
        projectProfiles: [
          {
            id: "shop",
            name: "Example Shop",
            expectedPort: 5173,
            mainUrl: "http://127.0.0.1:5173",
            logLines: ["vite ready in 420ms", "WARN deprecated env", "ERROR failed checkout", "Authorization: Bearer abc123"]
          }
        ]
      })
    );

    render(<App client={client} />);

    const devHealth = within(await screen.findByLabelText("Port 5173 details")).getByLabelText("Dev health for Example Shop");
    fireEvent.click(within(devHealth).getByRole("button", { name: /copy logs for example shop/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copiedText = String(writeText.mock.calls[0]?.[0] ?? "");
    expect(copiedText).toContain("Recent logs for Example Shop");
    expect(copiedText).toContain("- WARN deprecated env");
    expect(copiedText).toContain("- ERROR failed checkout");
    expect(copiedText).toContain("Authorization: Bearer [redacted]");
    expect(copiedText).not.toContain("abc123");
    expect(await screen.findByText("Copied logs for Example Shop")).toBeInTheDocument();
  });

  it("copies and opens the saved profile command from the detail card", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    window.localStorage.setItem(
      "localhost-control-settings",
      JSON.stringify({
        projectProfiles: [
          {
            id: "shop",
            name: "Example Shop",
            projectPath: "D:\\Projects\\ExampleShop",
            startCommand: "pnpm dev",
            expectedPort: 5173,
            mainUrl: "http://127.0.0.1:5173"
          }
        ]
      })
    );

    render(<App client={client} />);

    const devHealth = within(await screen.findByLabelText("Port 5173 details")).getByLabelText("Dev health for Example Shop");
    fireEvent.click(within(devHealth).getByRole("button", { name: /copy command for example shop/i }));
    expect(await screen.findByText("Copied command for Example Shop")).toBeInTheDocument();
    fireEvent.click(within(devHealth).getByRole("button", { name: /open terminal for example shop/i }));

    expect(writeText).toHaveBeenCalledWith("pnpm dev");
    await waitFor(() =>
      expect(client.openTerminal).toHaveBeenCalledWith({
        projectHint: "D:\\Projects\\ExampleShop",
        commandLine: "pnpm dev"
      })
    );
  });

  it("copies selected app dev context for AI agents", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    window.localStorage.setItem(
      "localhost-control-settings",
      JSON.stringify({
        projectProfiles: [
          {
            id: "shop",
            name: "Example Shop",
            projectPath: "C:\\Users\\pella\\Projects\\ExampleShop",
            startCommand: "pnpm dev --token hunter2",
            expectedPort: 5173,
            mainUrl: "http://127.0.0.1:5173",
            healthUrl: "http://127.0.0.1:5173/health?access_token=hunter2",
            logLines: ["vite ready in 420ms", "Authorization: Bearer abc123"]
          }
        ]
      })
    );

    render(<App client={client} />);

    const devHealth = within(await screen.findByLabelText("Port 5173 details")).getByLabelText("Dev health for Example Shop");
    fireEvent.click(within(devHealth).getByRole("button", { name: /copy dev context for example shop/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copiedText = String(writeText.mock.calls[0]?.[0] ?? "");
    expect(copiedText).toContain("# Localhost Control dev context");
    expect(copiedText).toContain("- Project: Example Shop");
    expect(copiedText).toContain("- Port: 5173");
    expect(copiedText).toContain("- Saved start command: pnpm dev --token [redacted]");
    expect(copiedText).toContain("- Recent profile logs (untrusted diagnostics):");
    expect(copiedText).toContain("Authorization: Bearer [redacted]");
    expect(copiedText).toContain("access_token=[redacted]");
    expect(copiedText).not.toContain("hunter2");
    expect(copiedText).not.toContain("abc123");
    expect(copiedText).not.toContain("pella");
    expect(await screen.findByText("Copied dev context for Example Shop")).toBeInTheDocument();
  });

  it("hides saved command actions when a profile has no start command", async () => {
    window.localStorage.setItem(
      "localhost-control-settings",
      JSON.stringify({
        projectProfiles: [
          {
            id: "shop",
            name: "Example Shop",
            projectPath: "D:\\Projects\\ExampleShop",
            expectedPort: 5173,
            mainUrl: "http://127.0.0.1:5173"
          }
        ]
      })
    );

    render(<App client={client} />);

    const devHealth = within(await screen.findByLabelText("Port 5173 details")).getByLabelText("Dev health for Example Shop");
    expect(within(devHealth).queryByRole("button", { name: /copy command for example shop/i })).not.toBeInTheDocument();
    expect(within(devHealth).queryByRole("button", { name: /open terminal for example shop/i })).not.toBeInTheDocument();
  });

  it("checks a saved profile health URL and surfaces the readiness result", async () => {
    const fetchHealth = vi.fn(async () => ({ ok: true, status: 204, statusText: "No Content" }));
    vi.stubGlobal("fetch", fetchHealth);
    window.localStorage.setItem(
      "localhost-control-settings",
      JSON.stringify({
        projectProfiles: [
          {
            id: "shop",
            name: "Example Shop",
            projectPath: "D:\\Projects\\ExampleShop",
            expectedPort: 5173,
            mainUrl: "http://127.0.0.1:5173",
            healthUrl: "http://127.0.0.1:5173/health"
          }
        ]
      })
    );

    render(<App client={client} />);

    const details = await screen.findByLabelText("Port 5173 details");
    fireEvent.click(within(details).getByRole("button", { name: /check health for example shop/i }));

    expect(await screen.findByText("Example Shop health check passed (204)")).toBeInTheDocument();
    expect(screen.getByLabelText("Project profiles")).toHaveTextContent("Healthy 204");
    expect(screen.getByLabelText("Port 5173 details")).toHaveTextContent("Healthy 204");
    expect(fetchHealth).toHaveBeenCalledWith(
      "http://127.0.0.1:5173/health",
      expect.objectContaining({ cache: "no-store", redirect: "manual" })
    );
  });

  it("drops external saved health URLs without marking a running profile unhealthy", async () => {
    const fetchHealth = vi.fn();
    vi.stubGlobal("fetch", fetchHealth);
    window.localStorage.setItem(
      "localhost-control-settings",
      JSON.stringify({
        projectProfiles: [
          {
            id: "shop",
            name: "Example Shop",
            projectPath: "D:\\Projects\\ExampleShop",
            expectedPort: 5173,
            mainUrl: "http://127.0.0.1:5173",
            healthUrl: "https://example.com/health"
          }
        ]
      })
    );

    render(<App client={client} />);

    const details = await screen.findByLabelText("Port 5173 details");
    expect(within(details).queryByRole("button", { name: /check health for example shop/i })).not.toBeInTheDocument();

    const profiles = screen.getByLabelText("Project profiles");
    expect(profiles).toHaveTextContent("running");
    expect(profiles).toHaveTextContent("Observed HTTP 200");
    expect(fetchHealth).not.toHaveBeenCalled();
  });

  it("keeps the newest profile health result when checks finish out of order", async () => {
    const responses: Array<(value: { ok: boolean; status: number; statusText: string }) => void> = [];
    const fetchHealth = vi.fn(
      () =>
        new Promise<{ ok: boolean; status: number; statusText: string }>((resolve) => {
          responses.push(resolve);
        })
    );
    vi.stubGlobal("fetch", fetchHealth);
    window.localStorage.setItem(
      "localhost-control-settings",
      JSON.stringify({
        projectProfiles: [
          {
            id: "shop",
            name: "Example Shop",
            projectPath: "D:\\Projects\\ExampleShop",
            expectedPort: 5173,
            mainUrl: "http://127.0.0.1:5173",
            healthUrl: "http://127.0.0.1:5173/health"
          }
        ]
      })
    );

    render(<App client={client} />);

    const details = await screen.findByLabelText("Port 5173 details");
    const button = within(details).getByRole("button", { name: /check health for example shop/i });
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(fetchHealth).toHaveBeenCalledTimes(2));
    responses[1]?.({ ok: false, status: 503, statusText: "Service Unavailable" });
    expect(await screen.findByText("Example Shop health check failed (503)")).toBeInTheDocument();
    expect(screen.getByLabelText("Project profiles")).toHaveTextContent("Unhealthy 503");

    responses[0]?.({ ok: true, status: 204, statusText: "No Content" });
    await waitFor(() => expect(screen.getByLabelText("Project profiles")).toHaveTextContent("Unhealthy 503"));
    expect(screen.getByLabelText("Project profiles")).not.toHaveTextContent("Healthy 204");
  });

  it("shows saved workspaces and opens all workspace URLs", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    window.localStorage.setItem(
      "localhost-control-settings",
      JSON.stringify({
        projectProfiles: [
          {
            id: "shop",
            name: "Example Shop",
            projectPath: "D:\\Projects\\ExampleShop",
            expectedPort: 5173,
            mainUrl: "http://127.0.0.1:5173",
            extraUrls: [{ label: "Admin", url: "http://127.0.0.1:5173/admin" }]
          },
          {
            id: "api",
            name: "Local API",
            expectedPort: 17321,
            mainUrl: "http://127.0.0.1:17321",
            extraUrls: [{ label: "OpenAPI", url: "http://127.0.0.1:17321/docs" }]
          },
          { id: "docs", name: "Docs", expectedPort: 4321, mainUrl: "http://127.0.0.1:4321" }
        ],
        projectWorkspaces: [{ id: "daily", name: "Daily stack", profileIds: ["shop", "api", "docs"], notes: "Morning release loop" }]
      })
    );

    render(<App client={client} />);

    const workspaces = await screen.findByLabelText("Project workspaces");
    expect(within(workspaces).getByText("Daily stack")).toBeInTheDocument();
    expect(within(workspaces).getByText("2 running, 1 needs attention")).toBeInTheDocument();
    expect(within(workspaces).getByText("Morning release loop")).toBeInTheDocument();

    fireEvent.click(within(workspaces).getByRole("button", { name: /open workspace daily stack/i }));

    expect(openSpy).toHaveBeenCalledWith("http://127.0.0.1:5173", "_blank", "noopener,noreferrer");
    expect(openSpy).toHaveBeenCalledWith("http://127.0.0.1:5173/admin", "_blank", "noopener,noreferrer");
    expect(openSpy).toHaveBeenCalledWith("http://127.0.0.1:17321", "_blank", "noopener,noreferrer");
    expect(openSpy).toHaveBeenCalledWith("http://127.0.0.1:17321/docs", "_blank", "noopener,noreferrer");
    expect(openSpy).toHaveBeenCalledWith("http://127.0.0.1:4321", "_blank", "noopener,noreferrer");
  });

  it("starts workspace profiles that have a saved project path and start command", async () => {
    window.localStorage.setItem(
      "localhost-control-settings",
      JSON.stringify({
        trustedProjectRoots: ["D:\\Projects"],
        projectProfiles: [
          {
            id: "shop",
            name: "Example Shop",
            projectPath: "D:\\Projects\\ExampleShop",
            startCommand: "pnpm dev",
            expectedPort: 5173,
            mainUrl: "http://127.0.0.1:5173"
          },
          {
            id: "api",
            name: "Local API",
            projectPath: "D:\\Projects\\LocalApi",
            startCommand: "pnpm api",
            expectedPort: 17321,
            mainUrl: "http://127.0.0.1:17321"
          },
          {
            id: "docs",
            name: "Docs",
            startCommand: "pnpm docs",
            expectedPort: 4321,
            mainUrl: "http://127.0.0.1:4321"
          }
        ],
        projectWorkspaces: [{ id: "daily", name: "Daily stack", profileIds: ["shop", "api", "docs"] }]
      })
    );

    render(<App client={client} />);

    const workspaces = await screen.findByLabelText("Project workspaces");
    fireEvent.click(within(workspaces).getByRole("button", { name: /start workspace daily stack/i }));

    await waitFor(() => expect(client.openTerminal).toHaveBeenCalledTimes(2));
    expect(client.openTerminal).toHaveBeenNthCalledWith(1, {
      projectHint: "D:\\Projects\\ExampleShop",
      commandLine: "pnpm dev",
      executeCommand: true
    });
    expect(client.openTerminal).toHaveBeenNthCalledWith(2, {
      projectHint: "D:\\Projects\\LocalApi",
      commandLine: "pnpm api",
      executeCommand: true
    });
    expect(await screen.findByText("Started workspace Daily stack: 2 commands")).toBeInTheDocument();
  });

  it("does not start a workspace without safe saved commands", async () => {
    window.localStorage.setItem(
      "localhost-control-settings",
      JSON.stringify({
        projectProfiles: [
          { id: "shop", name: "Example Shop", projectPath: "D:\\Projects\\ExampleShop", expectedPort: 5173, mainUrl: "http://127.0.0.1:5173" },
          { id: "api", name: "Local API", startCommand: "pnpm api", expectedPort: 17321, mainUrl: "http://127.0.0.1:17321" }
        ],
        projectWorkspaces: [{ id: "daily", name: "Daily stack", profileIds: ["shop", "api"] }]
      })
    );

    render(<App client={client} />);

    const workspaces = await screen.findByLabelText("Project workspaces");
    fireEvent.click(within(workspaces).getByRole("button", { name: /start workspace daily stack/i }));

    expect(client.openTerminal).not.toHaveBeenCalled();
    expect(await screen.findByText("No safe start commands configured for Daily stack")).toBeInTheDocument();
  });

  it("does not open or render imported external profile URLs", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    window.localStorage.setItem(
      "localhost-control-settings",
      JSON.stringify({
        projectProfiles: [
          {
            id: "shop",
            name: "Example Shop",
            projectPath: "D:\\Projects\\ExampleShop",
            expectedPort: 5173,
            mainUrl: "http://127.0.0.1:5173",
            extraUrls: [
              { label: "Local Admin", url: "http://127.0.0.1:5173/admin" },
              { label: "External Docs", url: "https://docs.example.com" }
            ]
          },
          { id: "external", name: "External Docs", expectedPort: 4321, mainUrl: "https://example.com" }
        ],
        projectWorkspaces: [{ id: "daily", name: "Daily stack", profileIds: ["shop", "external"] }]
      })
    );

    render(<App client={client} />);

    const profiles = await screen.findByLabelText("Project profiles");
    fireEvent.click(within(profiles).getByRole("button", { name: /external docs/i }));
    expect(openSpy).not.toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");

    fireEvent.click(within(await screen.findByLabelText("Project workspaces")).getByRole("button", { name: /open workspace daily stack/i }));
    expect(openSpy).toHaveBeenCalledWith("http://127.0.0.1:5173", "_blank", "noopener,noreferrer");
    expect(openSpy).not.toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");

    const details = screen.getByLabelText("Port 5173 details");
    expect(within(details).getByRole("link", { name: "Local Admin" })).toHaveAttribute("href", "http://127.0.0.1:5173/admin");
    expect(within(details).queryByRole("link", { name: "External Docs" })).not.toBeInTheDocument();
  });

  it("saves a workspace from the current project profiles", async () => {
    window.localStorage.setItem(
      "localhost-control-settings",
      JSON.stringify({
        projectProfiles: [
          { id: "shop", name: "Example Shop", projectPath: "D:\\Projects\\ExampleShop", expectedPort: 5173, mainUrl: "http://127.0.0.1:5173" },
          { id: "api", name: "Local API", expectedPort: 17321, mainUrl: "http://127.0.0.1:17321" }
        ]
      })
    );

    render(<App client={client} />);

    expect(await screen.findByLabelText("Project profiles")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /save workspace/i }));

    const workspaces = await screen.findByLabelText("Project workspaces");
    expect(within(workspaces).getByText("Example Shop + 1")).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("localhost-control-settings") ?? "{}")).toMatchObject({
      projectWorkspaces: [{ name: "Example Shop + 1", profileIds: ["shop", "api"] }]
    });
  });

  it("does not offer to save a duplicate workspace for the same profile set", async () => {
    window.localStorage.setItem(
      "localhost-control-settings",
      JSON.stringify({
        projectProfiles: [
          { id: "shop", name: "Example Shop", projectPath: "D:\\Projects\\ExampleShop", expectedPort: 5173, mainUrl: "http://127.0.0.1:5173" },
          { id: "api", name: "Local API", expectedPort: 17321, mainUrl: "http://127.0.0.1:17321" }
        ],
        projectWorkspaces: [{ id: "daily", name: "Daily stack", profileIds: ["shop", "api"] }]
      })
    );

    render(<App client={client} />);

    expect(await screen.findByLabelText("Project workspaces")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save workspace/i })).not.toBeInTheDocument();
  });

  it("saves the selected localhost app as a reusable project profile", async () => {
    render(<App client={client} />);

    expect(await screen.findByRole("button", { name: /select port 5173/i })).toBeInTheDocument();
    fireEvent.click(within(screen.getByLabelText("Port 5173 details")).getByRole("button", { name: /save profile/i }));

    const profiles = await screen.findByLabelText("Project profiles");
    expect(within(profiles).getByText("Example Shop")).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("localhost-control-settings") ?? "{}")).toMatchObject({
      projectProfiles: [
        {
          name: "Example Shop",
          projectPath: "D:\\Projects\\ExampleShop",
          expectedPort: 5173,
          mainUrl: "http://127.0.0.1:5173"
        }
      ]
    });
  });

  it("opens a detected localhost app directly from the port list row", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    render(<App client={client} />);

    expect(await screen.findByRole("button", { name: /select port 5173/i })).toBeInTheDocument();
    fireEvent.click(within(screen.getByLabelText("Detected localhost ports")).getByRole("button", { name: /open port 5173/i }));

    expect(openSpy).toHaveBeenCalledWith("http://127.0.0.1:5173", "_blank", "noopener,noreferrer");
  });

  it("shows tab open errors from the browser API", async () => {
    (globalThis as { browser?: unknown }).browser = {
      tabs: {
        create: vi.fn(async () => Promise.reject(new Error("tabs.create failed")))
      }
    };

    render(<App client={client} />);

    expect(await screen.findByRole("button", { name: /select port 5173/i })).toBeInTheDocument();
    fireEvent.click(within(screen.getByLabelText("Detected localhost ports")).getByRole("button", { name: /open port 5173/i }));

    expect(await screen.findByText("tabs.create failed")).toBeInTheDocument();
  });

  it("opens stopped profiles in their preferred browser window mode", async () => {
    const createTab = vi.fn(async () => undefined);
    const createWindow = vi.fn(async () => undefined);
    (globalThis as { browser?: unknown }).browser = {
      tabs: { create: createTab },
      windows: { create: createWindow }
    };
    window.localStorage.setItem(
      "localhost-control-settings",
      JSON.stringify({
        projectProfiles: [
          {
            id: "docs",
            name: "Docs",
            mainUrl: "http://127.0.0.1:4321",
            preferredOpenMode: "window"
          }
        ]
      })
    );

    render(<App client={client} />);

    const profiles = await screen.findByLabelText("Project profiles");
    fireEvent.click(within(profiles).getByRole("button", { name: /open profile docs/i }));

    await waitFor(() => expect(createWindow).toHaveBeenCalledWith({ url: "http://127.0.0.1:4321", type: "popup" }));
    expect(createTab).not.toHaveBeenCalled();
  });

  it("loads a saved dark theme and exposes the theme picker", async () => {
    window.localStorage.setItem("localhost-control-settings", JSON.stringify({ themeMode: "dark" }));

    render(<App client={client} />);

    expect(await screen.findByRole("button", { name: /select port 5173/i })).toBeInTheDocument();
    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "dark"));
    expect(screen.getByLabelText("Theme")).toHaveValue("dark");
  });

  it("switches the theme from the settings bar", async () => {
    render(<App client={client} />);

    expect(await screen.findByRole("button", { name: /select port 5173/i })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "dark" } });

    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "dark"));
    expect(JSON.parse(window.localStorage.getItem("localhost-control-settings") ?? "{}")).toMatchObject({ themeMode: "dark" });
  });

  it("shows storage errors when settings cannot be saved", async () => {
    (globalThis as { browser?: unknown }).browser = {
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => Promise.reject(new Error("storage quota exceeded")))
        }
      }
    };

    render(<App client={client} />);

    expect(await screen.findByRole("button", { name: /select port 5173/i })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "dark" } });

    expect(await screen.findByText("storage quota exceeded")).toBeInTheDocument();
    expect(screen.getByLabelText("Theme")).toHaveValue("system");
  });

  it("exports the current settings as a portable JSON file", async () => {
    const createObjectUrl = vi.fn(() => "blob:localhost-control-settings");
    const revokeObjectUrl = vi.fn();
    const anchorClick = vi.fn();
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectUrl });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(anchorClick);
    window.localStorage.setItem(
      "localhost-control-settings",
      JSON.stringify({
        projectProfiles: [{ id: "shop", name: "Example Shop", expectedPort: 5173, mainUrl: "http://127.0.0.1:5173" }]
      })
    );

    render(<App client={client} />);

    expect(await screen.findByLabelText("Project profiles")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /export settings/i }));

    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(anchorClick).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:localhost-control-settings");
    expect(await screen.findByText("Exported settings with 1 profile and 0 workspaces")).toBeInTheDocument();

    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalCreateObjectUrl });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: originalRevokeObjectUrl });
  });

  it("imports a portable settings JSON file through the settings bar", async () => {
    render(<App client={client} />);

    expect(await screen.findByRole("button", { name: /select port 5173/i })).toBeInTheDocument();
    const file = new File(
      [
        JSON.stringify({
          schema: "localhost-control-settings",
          version: 1,
          exportedAt: "2026-06-30T08:00:00.000Z",
          settings: {
            themeMode: "dark",
            projectProfiles: [
              { id: "shop", name: "Example Shop", expectedPort: 5173, mainUrl: "http://127.0.0.1:5173" },
              { id: "api", name: "Local API", expectedPort: 17321, mainUrl: "http://127.0.0.1:17321" }
            ],
            projectWorkspaces: [{ id: "daily", name: "Daily stack", profileIds: ["shop", "api"] }]
          }
        })
      ],
      "settings.json",
      { type: "application/json" }
    );

    fireEvent.change(screen.getByLabelText("Import settings file"), { target: { files: [file] } });

    const profiles = await screen.findByLabelText("Project profiles");
    expect(within(profiles).getByText("Example Shop")).toBeInTheDocument();
    expect(within(profiles).getByText("Local API")).toBeInTheDocument();
    expect(await screen.findByLabelText("Project workspaces")).toHaveTextContent("Daily stack");
    expect(await screen.findByText("Imported 2 profiles and 1 workspace")).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("localhost-control-settings") ?? "{}")).toMatchObject({
      themeMode: "dark",
      projectProfiles: [
        { id: "shop", name: "Example Shop" },
        { id: "api", name: "Local API" }
      ],
      projectWorkspaces: [{ id: "daily", profileIds: ["shop", "api"] }]
    });
  });

  it("does not overwrite settings when an imported config file is invalid", async () => {
    window.localStorage.setItem(
      "localhost-control-settings",
      JSON.stringify({
        projectProfiles: [{ id: "shop", name: "Example Shop", expectedPort: 5173, mainUrl: "http://127.0.0.1:5173" }]
      })
    );

    render(<App client={client} />);

    expect(await screen.findByLabelText("Project profiles")).toHaveTextContent("Example Shop");
    const file = new File(["{not-json"], "settings.json", { type: "application/json" });

    fireEvent.change(screen.getByLabelText("Import settings file"), { target: { files: [file] } });

    expect(await screen.findByText("Config import failed: invalid JSON")).toBeInTheDocument();
    expect(screen.getByLabelText("Project profiles")).toHaveTextContent("Example Shop");
    expect(JSON.parse(window.localStorage.getItem("localhost-control-settings") ?? "{}")).toMatchObject({
      projectProfiles: [{ id: "shop", name: "Example Shop" }]
    });
  });

  it("manages saved profiles, workspaces, trusted paths, hidden ports, and process rules", async () => {
    window.localStorage.setItem(
      "localhost-control-settings",
      JSON.stringify({
        hiddenPorts: [6463],
        trustedProjectRoots: ["D:\\DevelopmentD"],
        trustedProjectPaths: ["C:\\Workspaces\\LocalApi"],
        blockedProcessNames: ["steam.exe", "preview-service.exe"],
        projectProfiles: [
          { id: "shop", name: "Example Shop", expectedPort: 5173, mainUrl: "http://127.0.0.1:5173" },
          { id: "api", name: "Local API", expectedPort: 17321, mainUrl: "http://127.0.0.1:17321" }
        ],
        projectWorkspaces: [{ id: "daily", name: "Daily stack", profileIds: ["shop", "api"] }]
      })
    );

    render(<App client={client} />);

    expect(await screen.findByLabelText("Project workspaces")).toHaveTextContent("Daily stack");
    fireEvent.click(screen.getByRole("button", { name: /manage settings/i }));

    const manager = await screen.findByLabelText("Settings manager");
    await waitFor(() => expect(manager).toHaveFocus());
    expect(manager).toHaveTextContent("Example Shop");
    expect(manager).toHaveTextContent("Daily stack");
    expect(manager).toHaveTextContent("D:\\DevelopmentD");
    expect(manager).toHaveTextContent("C:\\Workspaces\\LocalApi");
    expect(manager).toHaveTextContent("6463");
    expect(manager).toHaveTextContent("preview-service.exe");

    const clickSettingsAction = async (name: RegExp, successText?: string) => {
      const button = within(screen.getByLabelText("Settings manager")).getByRole("button", { name });
      await waitFor(() => expect(button).not.toBeDisabled());
      fireEvent.click(button);
      if (successText) expect(await screen.findByText(successText)).toBeInTheDocument();
      await waitFor(() => expect(within(screen.getByLabelText("Settings manager")).queryByRole("button", { name })).not.toBeInTheDocument());
    };

    await clickSettingsAction(/remove profile local api/i, "Removed profile Local API");
    await waitFor(() => expect(screen.getByLabelText("Settings manager")).toHaveFocus());
    expect(screen.getByLabelText("Project workspaces")).toHaveTextContent("Daily stack");

    await clickSettingsAction(/remove workspace daily stack/i);
    await clickSettingsAction(/remove trusted path d:\\developmentd/i);
    await clickSettingsAction(/remove trusted path c:\\workspaces\\localapi/i);
    await clickSettingsAction(/unhide port 6463/i);
    await clickSettingsAction(/unblock process preview-service.exe/i);

    const saved = JSON.parse(window.localStorage.getItem("localhost-control-settings") ?? "{}");
    expect(saved).toMatchObject({
      hiddenPorts: [],
      trustedProjectRoots: [],
      trustedProjectPaths: [],
      blockedProcessNames: ["steam.exe"],
      projectProfiles: [{ id: "shop", name: "Example Shop" }],
      projectWorkspaces: []
    });
  });

  it("rolls back a settings manager removal when storage saving fails", async () => {
    (globalThis as { browser?: unknown }).browser = {
      storage: {
        local: {
          get: vi.fn(async () => ({
            "localhost-control-settings": {
              projectProfiles: [{ id: "shop", name: "Example Shop", expectedPort: 5173, mainUrl: "http://127.0.0.1:5173" }]
            }
          })),
          set: vi.fn(async () => Promise.reject(new Error("storage quota exceeded")))
        }
      }
    };

    render(<App client={client} />);

    expect(await screen.findByLabelText("Project profiles")).toHaveTextContent("Example Shop");
    fireEvent.click(screen.getByRole("button", { name: /manage settings/i }));
    const manager = await screen.findByLabelText("Settings manager");
    fireEvent.click(within(manager).getByRole("button", { name: /remove profile example shop/i }));

    expect(await screen.findByText("storage quota exceeded")).toBeInTheDocument();
    expect(screen.getByLabelText("Project profiles")).toHaveTextContent("Example Shop");
    expect(screen.getByLabelText("Settings manager")).toHaveTextContent("Example Shop");
  });

  it("disables settings manager actions while a removal is saving", async () => {
    let finishSave!: () => void;
    (globalThis as { browser?: unknown }).browser = {
      storage: {
        local: {
          get: vi.fn(async () => ({
            "localhost-control-settings": {
              projectProfiles: [
                { id: "shop", name: "Example Shop", expectedPort: 5173, mainUrl: "http://127.0.0.1:5173" },
                { id: "api", name: "Local API", expectedPort: 17321, mainUrl: "http://127.0.0.1:17321" }
              ]
            }
          })),
          set: vi.fn(
            () =>
              new Promise<void>((resolve) => {
                finishSave = resolve;
              })
          )
        }
      }
    };

    render(<App client={client} />);

    expect(await screen.findByLabelText("Project profiles")).toHaveTextContent("Example Shop");
    fireEvent.click(screen.getByRole("button", { name: /manage settings/i }));
    const manager = await screen.findByLabelText("Settings manager");
    fireEvent.click(within(manager).getByRole("button", { name: /remove profile local api/i }));

    expect(within(manager).getByRole("button", { name: /remove profile example shop/i })).toBeDisabled();
    finishSave();
    await waitFor(() => expect(within(screen.getByLabelText("Settings manager")).getByRole("button", { name: /remove profile example shop/i })).not.toBeDisabled());
  });

  it("removes a killed row immediately while the host is still stopping the process", async () => {
    let finishKill!: () => void;
    const slowClient: HostClient = {
      ...client,
      kill: vi.fn(
        () =>
          new Promise<KillResult>((resolve) => {
            finishKill = () => resolve({ killed: true, pid: 100, port: 5173, portClosed: true, message: "Killed 100" });
          })
      )
    };

    render(<App client={slowClient} />);
    expect(await screen.findByRole("button", { name: /select port 5173/i })).toBeInTheDocument();

    fireEvent.click(within(screen.getByLabelText("Detected localhost ports")).getByRole("button", { name: /kill port 5173/i }));

    fireEvent.click(screen.getByRole("button", { name: /force stop/i }));

    expect(screen.queryByRole("button", { name: /select port 5173/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Stopping PID 100/i)).toBeInTheDocument();

    finishKill();
    await waitFor(() => expect(slowClient.kill).toHaveBeenCalledWith({ pid: 100, port: 5173, mode: "force-tree" }));
  });

  it("filters to a custom port range", async () => {
    render(<App client={client} />);

    expect(await screen.findByRole("button", { name: /select port 5173/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    fireEvent.change(screen.getByLabelText("Custom port range"), { target: { value: "3500-3600" } });

    expect(screen.getByRole("button", { name: /select port 3515/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /select port 5173/i })).not.toBeInTheDocument();
  });

  it("trusts an external project path into Dev apps from the detail panel", async () => {
    render(<App client={client} />);

    expect(await screen.findByRole("button", { name: /select port 5173/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /select port 17321/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    fireEvent.click(screen.getByRole("button", { name: /select port 17321/i }));
    fireEvent.click(screen.getByRole("button", { name: /trust project/i }));
    fireEvent.click(screen.getByRole("button", { name: "Dev apps" }));

    expect(screen.getByRole("button", { name: /select port 17321/i })).toBeInTheDocument();
  });

  it("hides a noisy process from Dev apps immediately", async () => {
    render(<App client={client} />);

    expect(await screen.findByRole("button", { name: /select port 5173/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /select port 5173/i }));
    fireEvent.click(screen.getByRole("button", { name: /hide process/i }));

    expect(screen.queryByRole("button", { name: /select port 5173/i })).not.toBeInTheDocument();
  });

  it("opens a localhost fallback URL when the host has not probed a URL", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const { url: _url, title: _title, statusCode: _statusCode, ...baseEntry } = entries[0] as PortEntry;
    const unprobedEntry: PortEntry = {
      ...baseEntry,
      port: 4321
    };
    const unprobedClient: HostClient = {
      ...client,
      scan: vi.fn(async () => ({
        scannedAt: "2026-06-27T10:00:00.000Z",
        durationMs: 12,
        entries: [unprobedEntry]
      }))
    };

    render(<App client={unprobedClient} />);

    expect(await screen.findByRole("button", { name: /select port 4321/i })).toBeInTheDocument();
    fireEvent.click(within(screen.getByLabelText("Port 4321 details")).getByRole("button", { name: /open port 4321/i }));

    expect(openSpy).toHaveBeenCalledWith("http://127.0.0.1:4321", "_blank", "noopener,noreferrer");
  });

  it("falls back to a document copy command when clipboard.writeText is unavailable", async () => {
    const execCommand = vi.fn(() => true);
    document.execCommand = execCommand;

    render(<App client={client} />);

    expect(await screen.findByRole("button", { name: /select port 5173/i })).toBeInTheDocument();
    fireEvent.click(within(screen.getByLabelText("Port 5173 details")).getByRole("button", { name: /copy url for port 5173/i }));

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(await screen.findByText("Copied http://127.0.0.1:5173")).toBeInTheDocument();
  });

  it("shows terminal errors from the native host", async () => {
    const terminalClient: HostClient = {
      ...client,
      openTerminal: vi.fn(async () => Promise.reject(new Error("No supported terminal was found.")))
    };

    render(<App client={terminalClient} />);

    expect(await screen.findByRole("button", { name: /select port 5173/i })).toBeInTheDocument();
    fireEvent.click(within(screen.getByLabelText("Port 5173 details")).getByRole("button", { name: /open terminal for port 5173/i }));

    await waitFor(() => expect(terminalClient.openTerminal).toHaveBeenCalled());
    expect(await screen.findByText("No supported terminal was found.")).toBeInTheDocument();
  });

  it("cleans browser data for the selected localhost origin", async () => {
    const remove = vi.fn(async () => undefined);
    (globalThis as { browser?: unknown }).browser = {
      browsingData: { remove }
    };

    render(<App client={client} />);

    expect(await screen.findByRole("button", { name: /select port 5173/i })).toBeInTheDocument();
    fireEvent.click(within(screen.getByLabelText("Port 5173 details")).getByRole("button", { name: /clean app origin http:\/\/127\.0\.0\.1:5173/i }));

    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith(
        { origin: ["http://127.0.0.1:5173"], hostnames: ["127.0.0.1"], originTypes: { unprotectedWeb: true } },
        {
          cacheStorage: true,
          cookies: true,
          indexedDB: true,
          localStorage: true,
          serviceWorkers: true
        }
      )
    );
    expect(await screen.findByText("Cleared browser data for http://127.0.0.1:5173.")).toBeInTheDocument();
  });

  it("resets cache storage and service workers for the selected localhost origin", async () => {
    const remove = vi.fn(async () => undefined);
    (globalThis as { browser?: unknown }).browser = {
      browsingData: { remove }
    };

    render(<App client={client} />);

    expect(await screen.findByRole("button", { name: /select port 5173/i })).toBeInTheDocument();
    fireEvent.click(within(screen.getByLabelText("Port 5173 details")).getByRole("button", { name: /reset app cache http:\/\/127\.0\.0\.1:5173/i }));

    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith(
        { origin: ["http://127.0.0.1:5173"], hostnames: ["127.0.0.1"], originTypes: { unprotectedWeb: true } },
        {
          cacheStorage: true,
          serviceWorkers: true
        }
      )
    );
    expect(await screen.findByText("Cleared cache storage and service workers for http://127.0.0.1:5173.")).toBeInTheDocument();
  });

  it("shows install help when native host is unavailable", async () => {
    render(<App client={{ ...client, scan: vi.fn(async () => Promise.reject(new Error("Specified native messaging host not found."))) }} />);

    expect(await screen.findByText("Native host offline")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /download native host/i })).toBeInTheDocument();
    expect(screen.getByText(/install the localhost control native host/i)).toBeInTheDocument();
  });

  it("opens the native host download page once when the installed extension cannot find the host", async () => {
    const createTab = vi.fn();
    (globalThis as { browser?: unknown }).browser = {
      runtime: {
        getManifest: () => ({ version: "9.8.7" })
      },
      tabs: {
        create: createTab
      }
    };

    render(<App client={{ ...client, scan: vi.fn(async () => Promise.reject(new Error("No such native application com.localhost_control.host"))) }} />);

    expect(await screen.findByText("Native host offline")).toBeInTheDocument();
    await waitFor(() =>
      expect(createTab).toHaveBeenCalledWith({
        url: "https://github.com/LukasPellant/Localhost-Control/releases/tag/v9.8.7"
      })
    );
    expect(createTab).toHaveBeenCalledOnce();
  });

  it("keeps the detail panel aligned with the active filter", async () => {
    render(<App client={client} />);

    expect(await screen.findByRole("button", { name: /select port 5173/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Protected" }));

    expect(screen.getByRole("button", { name: /select port 135/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Port 135 details")).toBeInTheDocument();
    expect(screen.getByText("Protected system process")).toBeInTheDocument();
  });

  it("marks only the selected PID when multiple listeners share a port number", async () => {
    const baseEntry = entries[0]!;
    const duplicatePortEntries: PortEntry[] = [
      { ...baseEntry, pid: 100, port: 5173, title: "Vite IPv4" },
      { ...baseEntry, pid: 101, port: 5173, title: "Vite IPv6", address: "::1" }
    ];
    const duplicateClient: HostClient = {
      ...client,
      scan: vi.fn(async () => ({
        scannedAt: "2026-06-27T10:00:00.000Z",
        durationMs: 12,
        entries: duplicatePortEntries
      }))
    };

    render(<App client={duplicateClient} />);

    const selectButtons = await screen.findAllByRole("button", { name: /select port 5173/i });
    fireEvent.click(selectButtons[1]!);

    const selectedRows = document.querySelectorAll(".port-row.selected");
    expect(selectedRows).toHaveLength(1);
    expect(selectedRows[0]!).toHaveTextContent("PID 101");
    expect(screen.getByLabelText("Port 5173 details")).toHaveTextContent("101");
  });

  it("shows a port doctor conflict report for duplicate listeners", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    const baseEntry = entries[0]!;
    const duplicatePortEntries: PortEntry[] = [
      { ...baseEntry, pid: 100, port: 5173, title: "Vite IPv4" },
      { ...baseEntry, pid: 101, port: 5173, title: "Vite IPv6", address: "::1" },
      { ...baseEntry, pid: 200, port: 5174, title: "Vite alt" }
    ];
    const duplicateClient: HostClient = {
      ...client,
      scan: vi.fn(async () => ({
        scannedAt: "2026-06-27T10:00:00.000Z",
        durationMs: 12,
        entries: duplicatePortEntries
      }))
    };

    render(<App client={duplicateClient} />);

    expect((await screen.findAllByRole("button", { name: /select port 5173/i }))[0]).toBeInTheDocument();
    const doctor = screen.getByLabelText("Dev health for port 5173");
    expect(doctor).toHaveTextContent("2 listeners share port 5173");
    expect(doctor).toHaveTextContent("Next free: 5175");
    expect(doctor).toHaveTextContent("Fallback command: node vite");

    fireEvent.click(within(doctor).getByRole("button", { name: /copy doctor advice for port 5173/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(String(writeText.mock.calls[0]?.[0] ?? "")).toContain("Stop PID 101 or move one app to port 5175.");
    expect(await screen.findByText("Copied doctor advice for port 5173")).toBeInTheDocument();
  });

  it("surfaces stale process candidates in the list and detail panel", async () => {
    const staleEntry: PortEntry = {
      port: 8990,
      address: "::",
      pid: 900,
      processName: "preview-service.exe",
      commandLine: "preview-service --local --port 8990",
      detectedKind: "unknown",
      confidence: "low",
      killable: true,
      resources: {
        cpuPercent: 0.2,
        memoryBytes: 950_000_000,
        uptimeMs: 8 * 60 * 60 * 1000
      }
    };
    const staleClient: HostClient = {
      ...client,
      scan: vi.fn(async () => ({
        scannedAt: "2026-06-27T10:00:00.000Z",
        durationMs: 12,
        entries: [staleEntry]
      }))
    };

    render(<App client={staleClient} />);

    fireEvent.click(await screen.findByRole("button", { name: "Unknown" }));
    const row = await screen.findByRole("button", { name: /select port 8990/i });
    expect(row).toHaveTextContent("Possible stale process");
    expect(screen.getByLabelText("Dev health for port 8990")).toHaveTextContent("Long uptime");
    expect(screen.getByLabelText("Dev health for port 8990")).toHaveTextContent("High memory");
  });
});
