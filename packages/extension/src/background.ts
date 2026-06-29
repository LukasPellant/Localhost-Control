type ExtensionApi = typeof chrome & {
  browserAction?: typeof chrome.action;
  sidebarAction?: {
    open?: () => Promise<void> | void;
  };
};

type ToolbarTab = Pick<chrome.tabs.Tab, "id">;

const globalExtensionApi = globalThis as typeof globalThis & {
  browser?: ExtensionApi;
  chrome?: ExtensionApi;
};

const extensionApi = globalExtensionApi.browser ?? globalExtensionApi.chrome;
const actionApi = extensionApi?.action ?? extensionApi?.browserAction;

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
  }
};

actionApi?.onClicked.addListener((tab) => {
  void openExtensionPanel(extensionApi, tab);
});
