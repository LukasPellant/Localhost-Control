type ExtensionApi = typeof chrome & {
  browserAction?: typeof chrome.action;
  sidebarAction?: {
    open?: () => Promise<void> | void;
  };
};

const globalExtensionApi = globalThis as typeof globalThis & {
  browser?: ExtensionApi;
  chrome?: ExtensionApi;
};

const extensionApi = globalExtensionApi.browser ?? globalExtensionApi.chrome;
const actionApi = extensionApi?.action ?? extensionApi?.browserAction;

extensionApi?.runtime?.onInstalled.addListener(() => {
  void extensionApi.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true });
});

actionApi?.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  if (extensionApi?.sidebarAction?.open) {
    await extensionApi.sidebarAction.open();
    return;
  }

  try {
    await extensionApi?.sidePanel?.open?.({ tabId: tab.id });
  } catch {
    await extensionApi?.sidePanel?.setOptions?.({ tabId: tab.id, path: "sidepanel.html", enabled: true });
  }
});
