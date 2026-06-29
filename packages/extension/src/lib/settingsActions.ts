import type { Settings } from "./settings";

const normalizePath = (value: string): string =>
  value
    .trim()
    .replace(/\//g, "\\")
    .replace(/\\+$/, "")
    .toLowerCase();

export const removeProjectProfile = (settings: Settings, profileId: string): Settings => ({
  ...settings,
  projectProfiles: settings.projectProfiles.filter((profile) => profile.id !== profileId),
  projectWorkspaces: settings.projectWorkspaces.flatMap((workspace) => {
    const profileIds = workspace.profileIds.filter((id) => id !== profileId);
    return profileIds.length ? [{ ...workspace, profileIds }] : [];
  })
});

export const removeProjectWorkspace = (settings: Settings, workspaceId: string): Settings => ({
  ...settings,
  projectWorkspaces: settings.projectWorkspaces.filter((workspace) => workspace.id !== workspaceId)
});

export const removeTrustedProjectRoot = (settings: Settings, path: string): Settings => ({
  ...settings,
  trustedProjectRoots: settings.trustedProjectRoots.filter((item) => normalizePath(item) !== normalizePath(path))
});

export const removeTrustedProjectPath = (settings: Settings, path: string): Settings => ({
  ...settings,
  trustedProjectPaths: settings.trustedProjectPaths.filter((item) => normalizePath(item) !== normalizePath(path))
});

export const unhidePort = (settings: Settings, port: number): Settings => ({
  ...settings,
  hiddenPorts: settings.hiddenPorts.filter((item) => item !== port)
});

export const unblockProcessName = (settings: Settings, processName: string): Settings => ({
  ...settings,
  blockedProcessNames: settings.blockedProcessNames.filter((item) => item.toLowerCase() !== processName.toLowerCase())
});
