import { getExtensionApi } from "./extensionApi";
import { sanitizeActionAudit, type ActionAuditEntry } from "./actionAudit";
import { sanitizeProjectProfiles, type ProjectProfile } from "./projectProfiles";
import { sanitizeProjectWorkspaces, type ProjectWorkspace } from "./projectWorkspaces";

export type ThemeMode = "system" | "light" | "dark";

export type Settings = {
  includeSystemPorts: boolean;
  httpProbe: boolean;
  refreshIntervalSec: number;
  themeMode: ThemeMode;
  hiddenPorts: number[];
  customPortRange: string;
  trustedProjectRoots: string[];
  trustedProjectPaths: string[];
  blockedProcessNames: string[];
  projectProfiles: ProjectProfile[];
  projectWorkspaces: ProjectWorkspace[];
  actionAudit: ActionAuditEntry[];
};

const key = "localhost-control-settings";
const actionAuditKey = "localhost-control-action-audit";

const isSettingsPatch = (value: unknown): value is Partial<Settings> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isThemeMode = (value: unknown): value is ThemeMode => value === "system" || value === "light" || value === "dark";
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
const isHiddenPorts = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((item) => Number.isInteger(item) && item > 0 && item <= 65535);
const isRefreshInterval = (value: unknown): value is number => [0, 10, 30, 60].includes(Number(value)) && typeof value === "number";

export const sanitizeSettings = (value: unknown): Settings => {
  if (!isSettingsPatch(value)) return defaultSettings;

  const projectProfiles = sanitizeProjectProfiles(value.projectProfiles);

  return {
    includeSystemPorts: typeof value.includeSystemPorts === "boolean" ? value.includeSystemPorts : defaultSettings.includeSystemPorts,
    httpProbe: typeof value.httpProbe === "boolean" ? value.httpProbe : defaultSettings.httpProbe,
    refreshIntervalSec: isRefreshInterval(value.refreshIntervalSec) ? value.refreshIntervalSec : defaultSettings.refreshIntervalSec,
    themeMode: isThemeMode(value.themeMode) ? value.themeMode : defaultSettings.themeMode,
    hiddenPorts: isHiddenPorts(value.hiddenPorts) ? value.hiddenPorts : defaultSettings.hiddenPorts,
    customPortRange: typeof value.customPortRange === "string" ? value.customPortRange : defaultSettings.customPortRange,
    trustedProjectRoots: isStringArray(value.trustedProjectRoots) ? value.trustedProjectRoots : defaultSettings.trustedProjectRoots,
    trustedProjectPaths: isStringArray(value.trustedProjectPaths) ? value.trustedProjectPaths : defaultSettings.trustedProjectPaths,
    blockedProcessNames: isStringArray(value.blockedProcessNames) ? value.blockedProcessNames : defaultSettings.blockedProcessNames,
    projectProfiles,
    projectWorkspaces: sanitizeProjectWorkspaces(value.projectWorkspaces, projectProfiles),
    actionAudit: sanitizeActionAudit(value.actionAudit)
  };
};

const parseStoredSettings = (raw: string | null): Settings => {
  if (!raw) {
    return defaultSettings;
  }

  try {
    return sanitizeSettings(JSON.parse(raw) as unknown);
  } catch {
    return defaultSettings;
  }
};

const parseStoredActionAudit = (raw: string | null): ActionAuditEntry[] => {
  if (!raw) return [];

  try {
    return sanitizeActionAudit(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
};

export const defaultSettings: Settings = {
  includeSystemPorts: false,
  httpProbe: true,
  refreshIntervalSec: 0,
  themeMode: "system",
  hiddenPorts: [],
  customPortRange: "3000-9999",
  trustedProjectRoots: [],
  trustedProjectPaths: [],
  blockedProcessNames: ["steam.exe", "discord.exe", "battle.net.exe", "agent.exe", "nordvpn-service.exe", "ntkdaemon.exe", "qbittorrent.exe"],
  projectProfiles: [],
  projectWorkspaces: [],
  actionAudit: []
};

export const loadSettings = async (): Promise<Settings> => {
  const storage = getExtensionApi()?.storage?.local;
  if (storage) {
    try {
      const [settingsResult, actionAuditResult] = await Promise.all([storage.get(key), storage.get(actionAuditKey)]);
      return {
        ...sanitizeSettings(settingsResult[key]),
        actionAudit: sanitizeActionAudit(actionAuditResult[actionAuditKey])
      };
    } catch {
      return defaultSettings;
    }
  }

  return {
    ...parseStoredSettings(window.localStorage.getItem(key)),
    actionAudit: parseStoredActionAudit(window.localStorage.getItem(actionAuditKey))
  };
};

export const saveSettings = async (settings: Settings): Promise<void> => {
  const safeSettings = { ...sanitizeSettings(settings), actionAudit: [] };
  const storage = getExtensionApi()?.storage?.local;
  if (storage) {
    await storage.set({ [key]: safeSettings });
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(safeSettings));
};

export const saveActionAudit = async (actionAudit: ActionAuditEntry[]): Promise<void> => {
  const safeActionAudit = sanitizeActionAudit(actionAudit);
  const storage = getExtensionApi()?.storage?.local;
  if (storage) {
    await storage.set({ [actionAuditKey]: safeActionAudit });
    return;
  }

  window.localStorage.setItem(actionAuditKey, JSON.stringify(safeActionAudit));
};
