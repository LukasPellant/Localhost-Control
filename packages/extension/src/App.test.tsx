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
    detectedKind: "static",
    confidence: "medium",
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
    vi.clearAllMocks();
    delete (globalThis as { chrome?: unknown }).chrome;
    delete (globalThis as { browser?: unknown }).browser;
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
    await waitFor(() => expect(client.kill).toHaveBeenCalledWith({ pid: 100, port: 5173, mode: "force-tree" }));
    expect(await screen.findByText(/Killed 100/i)).toBeInTheDocument();
  });

  it("opens a detected localhost app directly from the port list row", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    render(<App client={client} />);

    expect(await screen.findByRole("button", { name: /select port 5173/i })).toBeInTheDocument();
    fireEvent.click(within(screen.getByLabelText("Detected localhost ports")).getByRole("button", { name: /open port 5173/i }));

    expect(openSpy).toHaveBeenCalledWith("http://127.0.0.1:5173", "_blank", "noopener,noreferrer");
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

  it("shows install help when native host is unavailable", async () => {
    render(<App client={{ ...client, scan: vi.fn(async () => Promise.reject(new Error("Specified native messaging host not found."))) }} />);

    expect(await screen.findByText("Native host offline")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /download native host/i })).toBeInTheDocument();
    expect(screen.getByText(/install the localhost control native host/i)).toBeInTheDocument();
  });

  it("opens the native host download page once when the installed extension cannot find the host", async () => {
    const createTab = vi.fn();
    (globalThis as { browser?: unknown }).browser = {
      tabs: {
        create: createTab
      }
    };

    render(<App client={{ ...client, scan: vi.fn(async () => Promise.reject(new Error("No such native application com.localhost_control.host"))) }} />);

    expect(await screen.findByText("Native host offline")).toBeInTheDocument();
    await waitFor(() =>
      expect(createTab).toHaveBeenCalledWith({
        url: "https://github.com/LukasPellant/Localhost-Control/releases/tag/v0.1.5"
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
});
