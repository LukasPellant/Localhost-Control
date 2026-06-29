import {
  HOST_NAME,
  isKillResult,
  isScanResult,
  type KillParams,
  type KillResult,
  type ScanParams,
  type ScanResult,
  type TerminalParams,
  type TerminalResult,
  type VersionResult
} from "@localhost-control/shared";
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
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isNativeErrorResult = (value: unknown): value is { error: string; message: string } =>
  isRecord(value) && typeof value.error === "string" && typeof value.message === "string";
const isTerminalResult = (value: unknown): value is TerminalResult =>
  isRecord(value) && typeof value.opened === "boolean" && typeof value.message === "string";
const isVersionResult = (value: unknown): value is VersionResult =>
  isRecord(value) && typeof value.version === "string" && typeof value.platform === "string";

const unwrapNativeResponse = <T>(response: NativeEnvelope<T> | undefined): T => {
  if (!response || !("result" in response)) {
    throw new Error("Native host returned an empty response.");
  }
  if (typeof response.result === "object" && response.result && "error" in response.result) {
    if (!isNativeErrorResult(response.result)) {
      throw new Error("Native host returned an invalid error response.");
    }
    throw new Error(response.result.message);
  }
  return response.result as T;
};

const validateNativeResult = <T>(value: T, isValid: (value: unknown) => boolean, label: string): T => {
  if (!isValid(value)) {
    throw new Error(`Native host returned an invalid ${label} response.`);
  }
  return value;
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
        reject(new Error(lastError.message ?? "Native messaging request failed."));
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
  scan: async (params) => validateNativeResult(await sendNative<ScanResult>({ method: "scan", params }), isScanResult, "scan"),
  kill: async (params) => validateNativeResult(await sendNative<KillResult>({ method: "kill", params }), isKillResult, "kill"),
  openTerminal: async (params) =>
    validateNativeResult(await sendNative<TerminalResult>({ method: "openTerminal", params }), isTerminalResult, "openTerminal"),
  version: async () => validateNativeResult(await sendNative<VersionResult>({ method: "version" }), isVersionResult, "version")
});

export const shouldUseMockClient = (isDevBuild = import.meta.env.DEV): boolean =>
  isDevBuild && (new URLSearchParams(window.location.search).has("mock") || !hasNativeMessaging());
