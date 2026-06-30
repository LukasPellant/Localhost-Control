type RuntimeLastError = {
  message?: string;
};

type RuntimeApi = {
  lastError?: RuntimeLastError;
  getManifest?: () => { version?: string };
  sendNativeMessage?: (application: string, message: unknown, callback?: (response: unknown) => void) => Promise<unknown> | void;
};

type StorageAreaApi = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

type TabsApi = {
  create(properties: { url: string }): Promise<unknown> | void;
};

type WindowsApi = {
  create(properties: {
    url: string;
    type?: "normal" | "popup";
    incognito?: boolean;
    focused?: boolean;
    width?: number;
    height?: number;
  }): Promise<unknown> | void;
};

type BrowsingDataApi = {
  remove(
    options: {
      origins?: string[];
      origin?: string[];
      hostnames?: string[];
      originTypes?: { unprotectedWeb?: boolean };
      since?: number;
    },
    dataToRemove: {
      cacheStorage?: boolean;
      cookies?: boolean;
      indexedDB?: boolean;
      localStorage?: boolean;
      serviceWorkers?: boolean;
    }
  ): Promise<void> | void;
};

type PermissionsApi = {
  contains?(permissions: { origins?: string[] }, callback?: (granted: boolean) => void): Promise<boolean> | void;
  request?(permissions: { origins?: string[] }, callback?: (granted: boolean) => void): Promise<boolean> | void;
};

export type ExtensionApi = {
  runtime?: RuntimeApi;
  storage?: {
    local?: StorageAreaApi;
  };
  tabs?: TabsApi;
  windows?: WindowsApi;
  browsingData?: BrowsingDataApi;
  permissions?: PermissionsApi;
};

export const getExtensionApi = (): ExtensionApi | undefined => {
  const root = globalThis as typeof globalThis & {
    browser?: ExtensionApi;
    chrome?: ExtensionApi;
  };
  return root.browser ?? root.chrome;
};

export const hasPromiseExtensionApi = (): boolean => {
  const root = globalThis as typeof globalThis & {
    browser?: ExtensionApi;
  };
  return Boolean(root.browser);
};
