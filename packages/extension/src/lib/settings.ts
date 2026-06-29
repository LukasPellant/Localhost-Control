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

const mergeStoredSettings = (value: unknown): Settings => (isSettingsPatch(value) ? { ...defaultSettings, ...value } : defaultSettings);

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
