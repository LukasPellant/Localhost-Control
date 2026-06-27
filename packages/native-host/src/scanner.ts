import { classifyPort, confidenceWeight, protectPortEntry, type PortEntry, type ScanParams, type ScanResult } from "@localhost-control/shared";
import { isLocalishListener, readTcpListeners, type Listener } from "./netstat.js";
import { probeListeners, type ProbeResult } from "./probe.js";
import { readProcessMetadata, type ProcessMetadata } from "./processMetadata.js";

const addressPriority = (address: string): number => {
  if (address === "127.0.0.1") return 4;
  if (address === "::1") return 3;
  if (address === "0.0.0.0") return 2;
  if (address === "::") return 1;
  return 0;
};

const dedupeListeners = (listeners: Listener[]): Listener[] => {
  const byPidPort = new Map<string, Listener>();
  for (const listener of listeners) {
    const key = `${listener.pid}:${listener.port}`;
    const existing = byPidPort.get(key);
    if (!existing || addressPriority(listener.address) > addressPriority(existing.address)) {
      byPidPort.set(key, listener);
    }
  }
  return Array.from(byPidPort.values());
};

export const buildPortEntries = async (
  listeners: Listener[],
  metadataByPid: Map<number, ProcessMetadata>,
  probesByPort: Map<number, ProbeResult>
): Promise<PortEntry[]> => {
  const entries = dedupeListeners(listeners).map((listener) => {
    const metadata = metadataByPid.get(listener.pid);
    const probe = probesByPort.get(listener.port);
    const classifyInput = { port: listener.port };
    const classification = classifyPort({
      ...classifyInput,
      ...(metadata?.processName ? { processName: metadata.processName } : {}),
      ...(metadata?.commandLine ? { commandLine: metadata.commandLine } : {}),
      ...(probe?.title ? { title: probe.title } : {}),
      ...(probe?.statusCode !== undefined ? { statusCode: probe.statusCode } : {})
    });

    const base: PortEntry = {
      port: listener.port,
      address: listener.address,
      pid: listener.pid,
      processName: metadata?.processName ?? `pid-${listener.pid}`,
      detectedKind: classification.detectedKind,
      confidence: classification.confidence,
      killable: false
    };

    if (metadata?.executablePath) base.executablePath = metadata.executablePath;
    if (metadata?.commandLine) base.commandLine = metadata.commandLine;
    if (metadata?.parentPid !== undefined) base.parentPid = metadata.parentPid;
    if (metadata?.projectHint) base.projectHint = metadata.projectHint;
    if (probe?.url) base.url = probe.url;
    if (probe?.title) base.title = probe.title;
    if (probe?.statusCode !== undefined) base.statusCode = probe.statusCode;

    return protectPortEntry(base);
  });

  return entries.sort((a, b) => {
    if (a.killable !== b.killable) return a.killable ? -1 : 1;
    const confidenceDelta = confidenceWeight(b.confidence) - confidenceWeight(a.confidence);
    return confidenceDelta || a.port - b.port || a.pid - b.pid;
  });
};

export const scanLocalPorts = async (params: ScanParams): Promise<ScanResult> => {
  const startedAt = performance.now();
  const listeners = (await readTcpListeners())
    .filter(isLocalishListener)
    .filter((listener) => params.includeSystemPorts || listener.port >= 1024);
  const pids = listeners.map((listener) => listener.pid);
  const metadataByPid = await readProcessMetadata(pids);
  const probesByPort = params.httpProbe ? await probeListeners(listeners, params.maxProbeMs) : new Map<number, ProbeResult>();
  const entries = await buildPortEntries(listeners, metadataByPid, probesByPort);

  return {
    entries,
    scannedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - startedAt)
  };
};
