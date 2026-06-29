import { getExtensionApi } from "./extensionApi";

export type ThemeMode = "system" | "light" | "dark";

export type Settings = {
  includeSystemPorts: boolean;
  httpProbe: boolean;
  refreshIntervalSec: number;
  themeMode: ThemeMode;
  hiddenPorts: number[];
  customPortRange: string;
  trustedProcessNames: string[];
  trustedProjectRoots: string[];
  trustedProjectPaths: string[];
  blockedProcessNames: string[];
};

const key = "localhost-control-settings";

export const defaultSettings: Settings = {
  includeSystemPorts: false,
  httpProbe: true,
  refreshIntervalSec: 0,
  themeMode: "system",
  hiddenPorts: [],
  customPortRange: "3000-9999",
  trustedProcessNames: ["node.exe", "python.exe", "bun.exe", "deno.exe"],
  trustedProjectRoots: ["D:\\Projects", "C:\\Projects"],
  trustedProjectPaths: [],
  blockedProcessNames: ["steam.exe", "discord.exe", "battle.net.exe", "agent.exe", "nordvpn-service.exe", "ntkdaemon.exe", "qbittorrent.exe"]
};

export const loadSettings = async (): Promise<Settings> => {
  const storage = getExtensionApi()?.storage?.local;
  if (storage) {
    const result = await storage.get(key);
    return { ...defaultSettings, ...(result[key] as Partial<Settings> | undefined) };
  }

  const raw = window.localStorage.getItem(key);
  return raw ? { ...defaultSettings, ...(JSON.parse(raw) as Partial<Settings>) } : defaultSettings;
};

export const saveSettings = async (settings: Settings): Promise<void> => {
  const storage = getExtensionApi()?.storage?.local;
  if (storage) {
    await storage.set({ [key]: settings });
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(settings));
};
