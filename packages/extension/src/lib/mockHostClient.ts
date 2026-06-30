import type { PortEntry } from "@localhost-control/shared";
import type { HostClient } from "./hostClient";

const sampleEntries: PortEntry[] = [
  {
    port: 5173,
    address: "127.0.0.1",
    pid: 6600,
    processName: "node.exe",
    commandLine: "node vite --host 127.0.0.1",
    projectHint: "D:\\Projects\\ExampleShop",
    detectedKind: "vite",
    confidence: "high",
    killable: true,
    url: "http://127.0.0.1:5173",
    statusCode: 200,
    title: "Example Shop",
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
    commandLine: "python -m http.server 8788 --bind 127.0.0.1",
    projectHint: "D:\\Projects\\DocsPreview",
    detectedKind: "python",
    confidence: "high",
    killable: true,
    url: "http://127.0.0.1:8788",
    statusCode: 200,
    title: "Docs Preview",
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
    commandLine: "node api-server.js --watch",
    projectHint: "D:\\Projects\\LocalApi",
    detectedKind: "node",
    confidence: "medium",
    killable: true,
    url: "http://127.0.0.1:17321",
    statusCode: 200,
    title: "Local API",
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
    processName: "preview-service.exe",
    commandLine: "preview-service --local --port 8990",
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
    async openProjectFolder(params) {
      return { opened: true, message: `Opened project folder ${params.projectPath}` };
    },
    async version() {
      return { version: "0.1.5", platform: "win32" };
    }
  };
};
