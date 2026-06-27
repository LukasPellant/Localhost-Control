import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { HostClient } from "./lib/hostClient";
import type { PortEntry } from "@localhost-control/shared";

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
