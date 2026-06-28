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
    projectHint: "D:\\DevelopmentD\\DrawCreator",
    detectedKind: "vite",
    confidence: "high",
    killable: true,
    url: "http://127.0.0.1:5173",
    statusCode: 200,
    title: "DrawCreator"
  },
  {
    port: 17321,
    address: "127.0.0.1",
    pid: 150,
    processName: "node.exe",
    commandLine: "node bridge",
    projectHint: "C:\\Users\\pella\\Documents\\ChatGPT-codex-bridge",
    detectedKind: "node",
    confidence: "medium",
    killable: true,
    url: "http://127.0.0.1:17321",
    statusCode: 200,
    title: "ChatGPT Codex Bridge"
  },
  {
    port: 6463,
    address: "127.0.0.1",
    pid: 250,
    processName: "Discord.exe",
    commandLine: "discord local listener",
    projectHint: "C:\\Users\\pella\\AppData\\Local\\Discord",
    detectedKind: "node",
    confidence: "medium",
    killable: true,
    url: "http://127.0.0.1:6463",
    statusCode: 200,
    title: "Discord"
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
    projectHint: "D:\\DevelopmentD\\AeroNavML",
    detectedKind: "static",
    confidence: "medium",
    killable: true,
    url: "http://127.0.0.1:5181",
    statusCode: 200,
    title: "AeroNavML Explainer"
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
  version: vi.fn(async () => ({ version: "0.1.0", platform: "win32" }))
};

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
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
    expect(screen.getByText("DrawCreator")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /select port 5173/i }));
    expect(screen.getByText("node vite")).toBeInTheDocument();

    fireEvent.click(within(screen.getByLabelText("Detected localhost ports")).getByRole("button", { name: /kill port 5173/i }));
    await waitFor(() => expect(client.kill).toHaveBeenCalledWith({ pid: 100, port: 5173, mode: "force-tree" }));
    expect(await screen.findByText(/Killed 100/i)).toBeInTheDocument();
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

  it("shows install help when native host is unavailable", async () => {
    render(<App client={{ ...client, scan: vi.fn(async () => Promise.reject(new Error("Specified native messaging host not found."))) }} />);

    expect(await screen.findByText("Native host offline")).toBeInTheDocument();
    expect(screen.getByText(/pnpm host:install/i)).toBeInTheDocument();
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
