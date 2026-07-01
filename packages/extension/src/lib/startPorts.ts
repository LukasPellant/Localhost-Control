import type { ProjectProfile as SavedProjectProfile } from "./projectProfiles";

export type ProjectProfile = SavedProjectProfile;

export type CommandPortPatchResult =
  | { ok: true; commandLine: string; changed: boolean }
  | { ok: false; message: string };

export type ProfilePortRetargetResult =
  | { ok: true; profile: ProjectProfile; changed: boolean }
  | { ok: false; message: string };

const tcpPort = (value: number): boolean => Number.isInteger(value) && value > 0 && value <= 65535;

const localUrlPort = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (!["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(hostname) && !hostname.endsWith(".localhost")) return undefined;
    const port = Number(url.port);
    return tcpPort(port) ? port : undefined;
  } catch {
    return undefined;
  }
};

export const preferredProfilePort = (profile: ProjectProfile): number | undefined =>
  tcpPort(profile.expectedPort ?? 0) ? profile.expectedPort : localUrlPort(profile.mainUrl) ?? localUrlPort(profile.healthUrl);

const retargetLocalUrl = (value: string | undefined, fromPort: number, toPort: number): string | undefined => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (Number(url.port) !== fromPort) return value;
    url.port = String(toPort);
    const next = url.toString();
    return url.pathname === "/" && !value.endsWith("/") && !url.search && !url.hash ? next.replace(/\/$/, "") : next;
  } catch {
    return value;
  }
};

const busyPortMessage = (port: number): string => `Port ${port} is busy and this command cannot be safely retargeted.`;

const hasExplicitPortFlag = (commandLine: string, fromPort: number, toPort: number): CommandPortPatchResult | undefined => {
  const exactLong = new RegExp(`(^|\\s)(--port)(\\s+)${fromPort}(?=\\s|$)`);
  if (exactLong.test(commandLine)) {
    return { ok: true, commandLine: commandLine.replace(exactLong, `$1$2$3${toPort}`), changed: true };
  }

  const equalsLong = new RegExp(`(^|\\s)(--port=)${fromPort}(?=\\s|$)`);
  if (equalsLong.test(commandLine)) {
    return { ok: true, commandLine: commandLine.replace(equalsLong, `$1$2${toPort}`), changed: true };
  }

  const exactShort = new RegExp(`(^|\\s)(-p)(\\s+)${fromPort}(?=\\s|$)`);
  if (exactShort.test(commandLine)) {
    return { ok: true, commandLine: commandLine.replace(exactShort, `$1$2$3${toPort}`), changed: true };
  }

  const equalsShort = new RegExp(`(^|\\s)(-p=)${fromPort}(?=\\s|$)`);
  if (equalsShort.test(commandLine)) {
    return { ok: true, commandLine: commandLine.replace(equalsShort, `$1$2${toPort}`), changed: true };
  }

  return undefined;
};

const isDirectDevServerCommand = (commandLine: string): boolean => {
  const normalized = commandLine.toLowerCase();
  return (
    /(^|\s|["'\\/])(vite|vite\.js)(["'\s]|$)/.test(normalized) ||
    /(^|\s)(next|astro|nuxt)(\.cmd|\.ps1)?\s+dev(\s|$)/.test(normalized)
  );
};

const isPackageDevScript = (commandLine: string): boolean => {
  const normalized = commandLine.trim().toLowerCase();
  return /^(pnpm|yarn|bun)(\.cmd|\.ps1)?\s+(run\s+)?dev(\s|$)/.test(normalized) || /^npm(\.cmd|\.ps1)?\s+run\s+dev(\s|$)/.test(normalized);
};

export const patchStartCommandPort = (commandLine: string, fromPort: number, toPort: number): CommandPortPatchResult => {
  if (fromPort === toPort) return { ok: true, commandLine, changed: false };

  const explicit = hasExplicitPortFlag(commandLine, fromPort, toPort);
  if (explicit) return explicit;

  const trimmed = commandLine.trim();
  if (isDirectDevServerCommand(trimmed)) {
    return { ok: true, commandLine: `${trimmed} --port ${toPort}`, changed: true };
  }
  if (isPackageDevScript(trimmed)) {
    const separator = trimmed.includes(" -- ") ? "" : " --";
    return { ok: true, commandLine: `${trimmed}${separator} --port ${toPort}`, changed: true };
  }

  return { ok: false, message: busyPortMessage(fromPort) };
};

export const retargetProfilePort = (profile: ProjectProfile, fromPort: number, toPort: number): ProfilePortRetargetResult => {
  const command = profile.startCommand ? patchStartCommandPort(profile.startCommand, fromPort, toPort) : undefined;
  if (command && !command.ok) return command;

  const next: ProjectProfile = {
    ...profile,
    expectedPort: toPort
  };
  if (command?.ok) next.startCommand = command.commandLine;
  if (profile.mainUrl) next.mainUrl = retargetLocalUrl(profile.mainUrl, fromPort, toPort) ?? profile.mainUrl;
  if (profile.healthUrl) next.healthUrl = retargetLocalUrl(profile.healthUrl, fromPort, toPort) ?? profile.healthUrl;
  if (profile.extraUrls) {
    next.extraUrls = profile.extraUrls.map((item) => ({ ...item, url: retargetLocalUrl(item.url, fromPort, toPort) ?? item.url }));
  }
  return { ok: true, profile: next, changed: JSON.stringify(next) !== JSON.stringify(profile) };
};
