import type { ProfileState, ProjectProfile } from "./projectProfiles";

export type ProjectWorkspace = {
  id: string;
  name: string;
  profileIds: string[];
  notes?: string;
};

export type WorkspaceState = {
  workspace: ProjectWorkspace;
  status: "healthy" | "degraded" | "stopped";
  runningCount: number;
  attentionCount: number;
  totalCount: number;
  healthLabel: string;
  openUrls: string[];
  profileStates: ProfileState[];
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const openUrlsForProfileState = (state: ProfileState): string[] => [
  ...(state.entry?.url ? [state.entry.url] : state.profile.mainUrl ? [state.profile.mainUrl] : []),
  ...(state.profile.extraUrls?.map((item) => item.url) ?? [])
];

export const sanitizeProjectWorkspaces = (value: unknown, profiles: ProjectProfile[]): ProjectWorkspace[] => {
  if (!Array.isArray(value)) return [];
  const profileIds = new Set(profiles.map((profile) => profile.id));
  const workspaceIds = new Set<string>();

  return value.flatMap((item): ProjectWorkspace[] => {
    if (!isRecord(item) || !isNonEmptyString(item.id) || !isNonEmptyString(item.name) || !Array.isArray(item.profileIds)) return [];
    const id = item.id.trim();
    if (workspaceIds.has(id)) return [];

    const uniqueIds = item.profileIds.reduce<string[]>((ids, profileId) => {
      if (!isNonEmptyString(profileId) || !profileIds.has(profileId.trim()) || ids.includes(profileId.trim())) return ids;
      return [...ids, profileId.trim()];
    }, []);
    if (!uniqueIds.length) return [];
    workspaceIds.add(id);

    const workspace: ProjectWorkspace = {
      id,
      name: item.name.trim(),
      profileIds: uniqueIds
    };
    if (isNonEmptyString(item.notes)) workspace.notes = item.notes.trim();
    return [workspace];
  });
};

export const deriveWorkspaceStates = (
  workspaces: ProjectWorkspace[],
  profiles: ProjectProfile[],
  profileStates: ProfileState[]
): WorkspaceState[] => {
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const stateById = new Map(profileStates.map((state) => [state.profile.id, state]));

  return workspaces.flatMap((workspace): WorkspaceState[] => {
    const memberStates = workspace.profileIds.flatMap((profileId): ProfileState[] => {
      const profile = profileById.get(profileId);
      const state = stateById.get(profileId);
      return profile && state ? [state] : [];
    });
    if (!memberStates.length) return [];

    const runningCount = memberStates.filter((state) => state.status === "running").length;
    const attentionCount = memberStates.length - runningCount;
    const status: WorkspaceState["status"] = runningCount === memberStates.length ? "healthy" : runningCount > 0 ? "degraded" : "stopped";
    const openUrls = [...new Set(memberStates.flatMap(openUrlsForProfileState))];

    return [
      {
        workspace,
        status,
        runningCount,
        attentionCount,
        totalCount: memberStates.length,
        healthLabel:
          attentionCount === 0
            ? `${runningCount} running`
            : `${runningCount} running, ${attentionCount} ${attentionCount === 1 ? "needs" : "need"} attention`,
        openUrls,
        profileStates: memberStates
      }
    ];
  });
};
