import { HOST_NAME, type KillParams, type KillResult, type ScanParams, type ScanResult, type TerminalParams, type TerminalResult, type VersionResult } from "@localhost-control/shared";
import { getExtensionApi, hasPromiseExtensionApi } from "./extensionApi";

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

const hasNativeMessaging = (): boolean => Boolean(getExtensionApi()?.runtime?.sendNativeMessage);

const unwrapNativeResponse = <T>(response: NativeEnvelope<T> | undefined): T => {
  if (!response || !("result" in response)) {
    throw new Error("Native host returned an empty response.");
  }
  if (typeof response.result === "object" && response.result && "error" in response.result) {
    throw new Error(response.result.message);
  }
  return response.result as T;
};

const sendNative = async <T>(request: NativeRequest): Promise<T> => {
  const api = getExtensionApi();
  if (!api?.runtime?.sendNativeMessage) {
    throw new Error("Native messaging is only available inside the installed extension.");
  }

  const message = { id: requestId(), ...request };
  if (hasPromiseExtensionApi()) {
    const response = (await api.runtime.sendNativeMessage(HOST_NAME, message)) as NativeEnvelope<T> | undefined;
    return unwrapNativeResponse(response);
  }

  return new Promise<T>((resolve, reject) => {
    api.runtime?.sendNativeMessage?.(HOST_NAME, message, (response) => {
      const lastError = api.runtime?.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      try {
        resolve(unwrapNativeResponse(response as NativeEnvelope<T> | undefined));
      } catch (error) {
        reject(error);
      }
    });
  });
};

export const createNativeHostClient = (): HostClient => ({
  scan: (params) => sendNative<ScanResult>({ method: "scan", params }),
  kill: (params) => sendNative<KillResult>({ method: "kill", params }),
  openTerminal: (params) => sendNative<TerminalResult>({ method: "openTerminal", params }),
  version: () => sendNative<VersionResult>({ method: "version" })
});

export const shouldUseMockClient = (isDevBuild = import.meta.env.DEV): boolean =>
  isDevBuild && (new URLSearchParams(window.location.search).has("mock") || !hasNativeMessaging());
