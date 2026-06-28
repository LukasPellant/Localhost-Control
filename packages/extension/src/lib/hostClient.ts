import { HOST_NAME, type KillParams, type KillResult, type ScanParams, type ScanResult, type TerminalParams, type TerminalResult, type VersionResult } from "@localhost-control/shared";

export type HostClient = {
  scan(params: ScanParams): Promise<ScanResult>;
  kill(params: KillParams): Promise<KillResult>;
  openTerminal(params: TerminalParams): Promise<TerminalResult>;
  version(): Promise<VersionResult>;
};

type NativeEnvelope<T> = {
  id: string;
  result: T | { error: string; message: string };
};

type NativeRequest =
  | { method: "scan"; params: ScanParams }
  | { method: "kill"; params: KillParams }
  | { method: "openTerminal"; params: TerminalParams }
  | { method: "version" };

const requestId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const hasChromeNativeMessaging = (): boolean =>
  typeof chrome !== "undefined" &&
  Boolean(chrome.runtime?.sendNativeMessage);

const sendNative = async <T>(request: NativeRequest): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    if (!hasChromeNativeMessaging()) {
      reject(new Error("Native messaging is only available inside the installed extension."));
      return;
    }

    const id = requestId();
    chrome.runtime.sendNativeMessage(HOST_NAME, { id, ...request }, (response: NativeEnvelope<T> | undefined) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      if (!response || !("result" in response)) {
        reject(new Error("Native host returned an empty response."));
        return;
      }
      if (typeof response.result === "object" && response.result && "error" in response.result) {
        reject(new Error(response.result.message));
        return;
      }
      resolve(response.result as T);
    });
  });

export const createNativeHostClient = (): HostClient => ({
  scan: (params) => sendNative<ScanResult>({ method: "scan", params }),
  kill: (params) => sendNative<KillResult>({ method: "kill", params }),
  openTerminal: (params) => sendNative<TerminalResult>({ method: "openTerminal", params }),
  version: () => sendNative<VersionResult>({ method: "version" })
});

export const shouldUseMockClient = (isDevBuild = import.meta.env.DEV): boolean =>
  isDevBuild && (new URLSearchParams(window.location.search).has("mock") || !hasChromeNativeMessaging());
