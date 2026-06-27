import type { Listener } from "./netstat.js";

export type ProbeResult = {
  url: string;
  statusCode: number;
  title?: string;
};

const urlForListener = (listener: Listener): string => {
  if (listener.address === "::1" || listener.address === "::") return `http://[::1]:${listener.port}`;
  return `http://127.0.0.1:${listener.port}`;
};

const extractTitle = (html: string): string | undefined => {
  const match = /<title[^>]*>(?<title>[^<]{1,160})<\/title>/i.exec(html);
  return match?.groups?.title?.replace(/\s+/g, " ").trim();
};

export const probeHttp = async (listener: Listener, maxProbeMs: number): Promise<ProbeResult | undefined> => {
  const url = urlForListener(listener);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), maxProbeMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    const result: ProbeResult = { url, statusCode: response.status };
    const title = extractTitle(text);
    if (title) result.title = title;
    return result;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
};

export const probeListeners = async (listeners: Listener[], maxProbeMs: number): Promise<Map<number, ProbeResult>> => {
  const byPort = new Map<number, Listener>();
  for (const listener of listeners) {
    if (!byPort.has(listener.port)) byPort.set(listener.port, listener);
  }

  const probes = await Promise.all(
    Array.from(byPort.values()).map(async (listener) => [listener.port, await probeHttp(listener, maxProbeMs)] as const)
  );

  return new Map(probes.filter((entry): entry is readonly [number, ProbeResult] => Boolean(entry[1])));
};
