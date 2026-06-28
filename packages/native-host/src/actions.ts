import { protectPortEntry, type KillParams, type KillResult, type TerminalParams, type TerminalResult } from "@localhost-control/shared";
import { killProcessTree as platformKillProcessTree, openTerminal as platformOpenTerminal } from "./platform/index.js";
import { isPortListening, readTcpListeners, type Listener } from "./netstat.js";
import { readProcessMetadata, type ProcessMetadata } from "./processMetadata.js";

const waitForPortClosed = async (port: number): Promise<boolean> => {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (!(await isPortListening(port))) return true;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return !(await isPortListening(port));
};

type KillTargetResolution =
  | { allowed: true }
  | { allowed: false; message: string };

const isPortListeningIn = (listeners: Listener[], port: number): boolean =>
  listeners.some((listener) => listener.port === port);

export const resolveKillTarget = (
  params: KillParams,
  listeners: Listener[],
  metadataByPid: Map<number, ProcessMetadata>
): KillTargetResolution => {
  const listener = listeners.find((item) => item.pid === params.pid && item.port === params.port);
  if (!listener) {
    return {
      allowed: false,
      message: `Refused to kill PID ${params.pid} because it is not the listener on port ${params.port}.`
    };
  }

  const metadata = metadataByPid.get(params.pid);
  const protectionInput = {
    port: listener.port,
    pid: listener.pid,
    processName: metadata?.processName ?? `pid-${listener.pid}`,
    detectedKind: "unknown",
    confidence: "low"
  } as const;
  const protectedEntry = protectPortEntry(
    metadata?.executablePath ? { ...protectionInput, executablePath: metadata.executablePath } : protectionInput
  );

  if (!protectedEntry.killable) {
    return {
      allowed: false,
      message: `Refused to kill PID ${params.pid} on port ${params.port}: ${protectedEntry.protectionReason}.`
    };
  }

  return { allowed: true };
};

export const killProcessTree = async (params: KillParams): Promise<KillResult> => {
  const [listeners, metadataByPid] = await Promise.all([readTcpListeners(), readProcessMetadata([params.pid])]);
  const target = resolveKillTarget(params, listeners, metadataByPid);
  if (!target.allowed) {
    return {
      killed: false,
      pid: params.pid,
      port: params.port,
      portClosed: !isPortListeningIn(listeners, params.port),
      message: target.message
    };
  }

  try {
    await platformKillProcessTree(params);
    const portClosed = await waitForPortClosed(params.port);
    return {
      killed: true,
      pid: params.pid,
      port: params.port,
      portClosed,
      message: portClosed ? `Killed PID ${params.pid}; port ${params.port} is closed.` : `Killed PID ${params.pid}; port ${params.port} is still listening.`
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      killed: false,
      pid: params.pid,
      port: params.port,
      portClosed: !(await isPortListening(params.port)),
      message
    };
  }
};

export const openTerminal = async (params: TerminalParams): Promise<TerminalResult> => platformOpenTerminal(params);
