export type Settings = {
  includeSystemPorts: boolean;
  httpProbe: boolean;
  refreshIntervalSec: number;
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
  hiddenPorts: [],
  customPortRange: "3000-9999",
  trustedProcessNames: ["node.exe", "python.exe", "bun.exe", "deno.exe"],
  trustedProjectRoots: ["D:\\DevelopmentD"],
  trustedProjectPaths: [],
  blockedProcessNames: ["steam.exe", "discord.exe", "battle.net.exe", "agent.exe", "nordvpn-service.exe", "ntkdaemon.exe", "qbittorrent.exe"]
};

export const loadSettings = async (): Promise<Settings> => {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    const result = await chrome.storage.local.get(key);
    return { ...defaultSettings, ...(result[key] as Partial<Settings> | undefined) };
  }

  const raw = window.localStorage.getItem(key);
  return raw ? { ...defaultSettings, ...(JSON.parse(raw) as Partial<Settings>) } : defaultSettings;
};

export const saveSettings = async (settings: Settings): Promise<void> => {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    await chrome.storage.local.set({ [key]: settings });
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(settings));
};
