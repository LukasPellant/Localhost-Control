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
});
