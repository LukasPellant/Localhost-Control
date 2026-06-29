type RuntimeLastError = {
  message?: string;
};

type RuntimeApi = {
  lastError?: RuntimeLastError;
  sendNativeMessage?: (application: string, message: unknown, callback?: (response: unknown) => void) => Promise<unknown> | void;
};

type StorageAreaApi = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

type TabsApi = {
  create(properties: { url: string }): Promise<unknown> | void;
};

export type ExtensionApi = {
  runtime?: RuntimeApi;
  storage?: {
    local?: StorageAreaApi;
  };
  tabs?: TabsApi;
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
