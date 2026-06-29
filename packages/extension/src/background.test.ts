import { describe, expect, it, vi } from "vitest";
import { openExtensionPanel, registerToolbarOpenHandler } from "./background";

type ExtensionApi = Parameters<typeof openExtensionPanel>[0];

describe("openExtensionPanel", () => {
  it("opens the Firefox sidebar even when the active tab has no id", async () => {
    const open = vi.fn();

    await openExtensionPanel({ sidebarAction: { open } } as unknown as ExtensionApi, {});

    expect(open).toHaveBeenCalledOnce();
  });

  it("does not try to open the Chrome side panel without a tab id", async () => {
    const open = vi.fn();

    await openExtensionPanel({ sidePanel: { open } } as unknown as ExtensionApi, {});

    expect(open).not.toHaveBeenCalled();
  });

  it("enables and reopens the Chrome side panel when the first open call fails", async () => {
    const open = vi.fn().mockRejectedValueOnce(new Error("Side panel not enabled")).mockResolvedValueOnce(undefined);
    const setOptions = vi.fn().mockResolvedValue(undefined);

    await openExtensionPanel({ sidePanel: { open, setOptions } } as unknown as ExtensionApi, { id: 42 });

    expect(setOptions).toHaveBeenCalledWith({ tabId: 42, path: "sidepanel.html", enabled: true });
    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenLastCalledWith({ tabId: 42 });
  });
});

describe("registerToolbarOpenHandler", () => {
  it("listens for Firefox-compatible browserAction clicks when action is also present", () => {
    const actionAddListener = vi.fn();
    const browserActionAddListener = vi.fn();

    registerToolbarOpenHandler({
      action: { onClicked: { addListener: actionAddListener } },
      browserAction: { onClicked: { addListener: browserActionAddListener } }
    } as unknown as ExtensionApi);

    expect(actionAddListener).toHaveBeenCalledOnce();
    expect(browserActionAddListener).toHaveBeenCalledOnce();
  });

  it("does not leak failed toolbar opens as unhandled rejections", async () => {
    const addListener = vi.fn();
    const open = vi.fn().mockRejectedValue(new Error("side panel blocked"));
    const setOptions = vi.fn().mockRejectedValue(new Error("side panel still blocked"));

    registerToolbarOpenHandler({
      action: { onClicked: { addListener } },
      sidePanel: { open, setOptions }
    } as unknown as ExtensionApi);

    const handler = addListener.mock.calls[0]?.[0] as ((tab: { id: number }) => void) | undefined;
    expect(handler).toBeDefined();
    handler?.({ id: 42 });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(open).toHaveBeenCalledWith({ tabId: 42 });
    expect(setOptions).toHaveBeenCalledWith({ tabId: 42, path: "sidepanel.html", enabled: true });
  });
});
