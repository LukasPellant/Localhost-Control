import { HOST_NAME, type KillParams, type KillResult, type PortEntry, type ScanParams, type ScanResult, type TerminalParams, type TerminalResult, type VersionResult } from "@localhost-control/shared";

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

const sampleEntries: PortEntry[] = [
  {
    port: 5173,
    address: "127.0.0.1",
    pid: 6600,
    processName: "node.exe",
    commandLine: "node vite --host 127.0.0.1",
    projectHint: "D:\\DevelopmentD\\DrawCreator",
    detectedKind: "vite",
    confidence: "high",
    killable: true,
    url: "http://127.0.0.1:5173",
    statusCode: 200,
    title: "DrawCreator",
    resources: {
      cpuPercent: 6.8,
      memoryBytes: 241_172_480,
      privateMemoryBytes: 165_675_008,
      threadCount: 24,
      handleCount: 348,
      uptimeMs: 1_320_000
    }
  },
  {
    port: 8788,
    address: "127.0.0.1",
    pid: 56620,
    processName: "python.exe",
    commandLine: "python -m evaluation.run_console --port 8788",
    projectHint: "D:\\DevelopmentD\\AeroNavML",
    detectedKind: "python",
    confidence: "high",
    killable: true,
    url: "http://127.0.0.1:8788",
    statusCode: 200,
    title: "AeroNavML console",
    resources: {
      cpuPercent: 18.2,
      memoryBytes: 517_996_544,
      privateMemoryBytes: 342_884_352,
      threadCount: 16,
      handleCount: 190,
      uptimeMs: 3_840_000
    }
  },
  {
    port: 17321,
    address: "127.0.0.1",
    pid: 19320,
    processName: "node.exe",
    commandLine: "node bridge-server.js",
    projectHint: "C:\\Users\\pella\\Documents\\ChatGPT-codex-bridge",
    detectedKind: "node",
    confidence: "medium",
    killable: true,
    url: "http://127.0.0.1:17321",
    statusCode: 200,
    title: "Import bridge",
    resources: {
      cpuPercent: 1.4,
      memoryBytes: 126_877_696,
      privateMemoryBytes: 78_643_200,
      threadCount: 14,
      handleCount: 155,
      uptimeMs: 7_200_000
    }
  },
  {
    port: 8990,
    address: "::",
    pid: 52620,
    processName: "ProjectAirSim.exe",
    commandLine: "ProjectAirSim Blocks",
    detectedKind: "unknown",
    confidence: "low",
    killable: true,
    resources: {
      cpuPercent: 22.7,
      memoryBytes: 1_384_120_320,
      privateMemoryBytes: 1_006_632_960,
      threadCount: 48,
      handleCount: 912,
      uptimeMs: 540_000
    }
  },
  {
    port: 135,
    address: "0.0.0.0",
    pid: 4,
    processName: "System",
    executablePath: "C:\\Windows\\System32\\ntoskrnl.exe",
    detectedKind: "unknown",
    confidence: "low",
    killable: false,
    protectionReason: "Protected system process"
  }
];

export const createMockHostClient = (): HostClient => {
  let entries = [...sampleEntries];

  return {
    async scan() {
      return {
        entries,
        scannedAt: new Date().toISOString(),
        durationMs: 28
      };
    },
    async kill(params) {
      entries = entries.filter((entry) => !(entry.pid === params.pid && entry.port === params.port));
      return {
        killed: true,
        pid: params.pid,
        port: params.port,
        portClosed: true,
        message: `Killed PID ${params.pid}; port ${params.port} is closed.`
      };
    },
    async openTerminal(params) {
      return { opened: true, message: `Opened terminal in ${params.projectHint ?? "home"}` };
    },
    async version() {
      return { version: "0.1.0", platform: "win32" };
    }
  };
};

export const shouldUseMockClient = (): boolean =>
  new URLSearchParams(window.location.search).has("mock") || !hasChromeNativeMessaging();
