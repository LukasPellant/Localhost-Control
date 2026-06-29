import { getExtensionApi } from "./extensionApi";

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
};

const key = "localhost-control-settings";

const isSettingsPatch = (value: unknown): value is Partial<Settings> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isThemeMode = (value: unknown): value is ThemeMode => value === "system" || value === "light" || value === "dark";
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
const isHiddenPorts = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((item) => Number.isInteger(item) && item > 0 && item <= 65535);
const isRefreshInterval = (value: unknown): value is number => [0, 10, 30, 60].includes(Number(value)) && typeof value === "number";

const mergeStoredSettings = (value: unknown): Settings => {
  if (!isSettingsPatch(value)) return defaultSettings;

  return {
    includeSystemPorts: typeof value.includeSystemPorts === "boolean" ? value.includeSystemPorts : defaultSettings.includeSystemPorts,
    httpProbe: typeof value.httpProbe === "boolean" ? value.httpProbe : defaultSettings.httpProbe,
    refreshIntervalSec: isRefreshInterval(value.refreshIntervalSec) ? value.refreshIntervalSec : defaultSettings.refreshIntervalSec,
    themeMode: isThemeMode(value.themeMode) ? value.themeMode : defaultSettings.themeMode,
    hiddenPorts: isHiddenPorts(value.hiddenPorts) ? value.hiddenPorts : defaultSettings.hiddenPorts,
    customPortRange: typeof value.customPortRange === "string" ? value.customPortRange : defaultSettings.customPortRange,
    trustedProjectRoots: isStringArray(value.trustedProjectRoots) ? value.trustedProjectRoots : defaultSettings.trustedProjectRoots,
    trustedProjectPaths: isStringArray(value.trustedProjectPaths) ? value.trustedProjectPaths : defaultSettings.trustedProjectPaths,
    blockedProcessNames: isStringArray(value.blockedProcessNames) ? value.blockedProcessNames : defaultSettings.blockedProcessNames
  };
};

const parseStoredSettings = (raw: string | null): Settings => {
  if (!raw) {
    return defaultSettings;
  }

  try {
    return mergeStoredSettings(JSON.parse(raw) as unknown);
  } catch {
    return defaultSettings;
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
  blockedProcessNames: ["steam.exe", "discord.exe", "battle.net.exe", "agent.exe", "nordvpn-service.exe", "ntkdaemon.exe", "qbittorrent.exe"]
};

export const loadSettings = async (): Promise<Settings> => {
  const storage = getExtensionApi()?.storage?.local;
  if (storage) {
    const result = await storage.get(key);
    return mergeStoredSettings(result[key]);
  }

  return parseStoredSettings(window.localStorage.getItem(key));
};

export const saveSettings = async (settings: Settings): Promise<void> => {
  const storage = getExtensionApi()?.storage?.local;
  if (storage) {
    await storage.set({ [key]: settings });
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(settings));
};
