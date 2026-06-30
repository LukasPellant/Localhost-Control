import { afterEach, describe, expect, it } from "vitest";
import { createNativeHostClient, shouldUseMockClient } from "./hostClient";

const originalUrl = window.location.href;

afterEach(() => {
  window.history.replaceState(null, "", originalUrl);
  Reflect.deleteProperty(globalThis, "chrome");
  Reflect.deleteProperty(globalThis, "browser");
});

describe("shouldUseMockClient", () => {
  it("keeps demo data disabled in production builds", () => {
    window.history.replaceState(null, "", "/sidepanel.html?mock=1");

    expect(shouldUseMockClient(false)).toBe(false);
  });

  it("allows demo data only during development", () => {
    window.history.replaceState(null, "", "/sidepanel.html?mock=1");

    expect(shouldUseMockClient(true)).toBe(true);
  });

  it("detects Firefox browser native messaging as an installed extension context", () => {
    (globalThis as { browser?: unknown }).browser = {
      runtime: {
        sendNativeMessage: async () => ({ id: "version-1", result: { version: "0.1.6", platform: "win32" } })
      }
    };

    expect(shouldUseMockClient(true)).toBe(false);
  });
});

describe("createNativeHostClient", () => {
  it("uses Firefox promise-based native messaging when the browser namespace is available", async () => {
    (globalThis as { browser?: unknown }).browser = {
      runtime: {
        sendNativeMessage: async (_hostName: string, message: { id: string; method: string }) => ({
          id: message.id,
          result: { version: "0.1.6", platform: "win32" }
        })
      }
    };

    await expect(createNativeHostClient().version()).resolves.toEqual({ version: "0.1.6", platform: "win32" });
  });

  it("rejects malformed scan responses before they reach the UI", async () => {
    (globalThis as { browser?: unknown }).browser = {
      runtime: {
        sendNativeMessage: async (_hostName: string, message: { id: string; method: string }) => ({
          id: message.id,
          result: { entries: "not-an-array" }
        })
      }
    };

    await expect(createNativeHostClient().scan({ includeSystemPorts: false, httpProbe: true, maxProbeMs: 550 })).rejects.toThrow(
      "Native host returned an invalid scan response."
    );
  });

  it("rejects malformed native host error envelopes with a useful message", async () => {
    (globalThis as { browser?: unknown }).browser = {
      runtime: {
        sendNativeMessage: async (_hostName: string, message: { id: string; method: string }) => ({
          id: message.id,
          result: { error: "internal_error" }
        })
      }
    };

    await expect(createNativeHostClient().version()).rejects.toThrow("Native host returned an invalid error response.");
  });

  it("sends project path, command line, and execute flag when starting a profile command", async () => {
    let sentMessage: unknown;
    (globalThis as { browser?: unknown }).browser = {
      runtime: {
        sendNativeMessage: async (_hostName: string, message: unknown) => {
          sentMessage = message;
          return { id: "terminal-1", result: { opened: true, message: "Started command" } };
        }
      }
    };

    await expect(
      createNativeHostClient().openTerminal({
        projectHint: "D:\\Projects\\ExampleShop",
        commandLine: "pnpm dev",
        executeCommand: true
      })
    ).resolves.toEqual({ opened: true, message: "Started command" });

    expect(sentMessage).toMatchObject({
      method: "openTerminal",
      params: {
        projectHint: "D:\\Projects\\ExampleShop",
        commandLine: "pnpm dev",
        executeCommand: true
      }
    });
  });

  it("sends project folder open requests through native messaging", async () => {
    let sentMessage: unknown;
    (globalThis as { browser?: unknown }).browser = {
      runtime: {
        sendNativeMessage: async (_hostName: string, message: unknown) => {
          sentMessage = message;
          return { id: "folder-1", result: { opened: true, message: "Opened project folder D:\\Projects\\ExampleShop" } };
        }
      }
    };

    await expect(createNativeHostClient().openProjectFolder({ projectPath: "D:\\Projects\\ExampleShop" })).resolves.toEqual({
      opened: true,
      message: "Opened project folder D:\\Projects\\ExampleShop"
    });

    expect(sentMessage).toMatchObject({
      method: "openProjectFolder",
      params: { projectPath: "D:\\Projects\\ExampleShop" }
    });
  });

  it("rejects malformed project folder responses before they reach the UI", async () => {
    (globalThis as { browser?: unknown }).browser = {
      runtime: {
        sendNativeMessage: async (_hostName: string, message: { id: string; method: string }) => ({
          id: message.id,
          result: { opened: "yes", message: "Opened" }
        })
      }
    };

    await expect(createNativeHostClient().openProjectFolder({ projectPath: "D:\\Projects\\ExampleShop" })).rejects.toThrow(
      "Native host returned an invalid openProjectFolder response."
    );
  });

  it("uses a fallback message for callback native messaging errors without a message", async () => {
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        lastError: {},
        sendNativeMessage: (_hostName: string, _message: unknown, callback: (response: unknown) => void) => {
          callback(undefined);
        }
      }
    };

    await expect(createNativeHostClient().version()).rejects.toThrow("Native messaging request failed.");
  });
});
