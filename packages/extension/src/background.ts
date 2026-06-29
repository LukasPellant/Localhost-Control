type ExtensionApi = typeof chrome & {
  browserAction?: typeof chrome.action;
  sidebarAction?: {
    open?: () => Promise<void> | void;
  };
};

type ToolbarTab = Pick<chrome.tabs.Tab, "id">;
type ToolbarClickEvent = NonNullable<ExtensionApi["action"]>["onClicked"];

const globalExtensionApi = globalThis as typeof globalThis & {
  browser?: ExtensionApi;
  chrome?: ExtensionApi;
};

const extensionApi = globalExtensionApi.browser ?? globalExtensionApi.chrome;

extensionApi?.runtime?.onInstalled.addListener(() => {
  void extensionApi.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true });
});

export const openExtensionPanel = async (extensionApi: ExtensionApi | undefined, tab: ToolbarTab): Promise<void> => {
  if (extensionApi?.sidebarAction?.open) {
    await extensionApi.sidebarAction.open();
    return;
  }

  if (!tab.id) return;

  try {
    await extensionApi?.sidePanel?.open?.({ tabId: tab.id });
  } catch {
    await extensionApi?.sidePanel?.setOptions?.({ tabId: tab.id, path: "sidepanel.html", enabled: true });
    await extensionApi?.sidePanel?.open?.({ tabId: tab.id });
  }
};

export const registerToolbarOpenHandler = (extensionApi: ExtensionApi | undefined): void => {
  const registeredEvents = new Set<ToolbarClickEvent>();

  for (const actionApi of [extensionApi?.action, extensionApi?.browserAction]) {
    if (!actionApi?.onClicked || registeredEvents.has(actionApi.onClicked)) continue;

    registeredEvents.add(actionApi.onClicked);
    actionApi.onClicked.addListener((tab) => {
      void openExtensionPanel(extensionApi, tab);
    });
  }
};

registerToolbarOpenHandler(extensionApi);
