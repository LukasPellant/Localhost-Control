import { useMemo, useState } from "react";
import type { Settings } from "../lib/settings";
import type { ActionAuditEntry, ActionAuditKind } from "../lib/actionAudit";
import type { ProjectProfile } from "../lib/projectProfiles";
import { uniqueLocalId } from "../lib/localIds";

type SettingsManagerProps = {
  settings: Settings;
  saving?: boolean;
  onSaveProfile(profile: ProjectProfile): Promise<boolean>;
  onRemoveProfile(profileId: string, name: string): void;
  onRemoveWorkspace(workspaceId: string, name: string): void;
  onRemoveTrustedRoot(path: string): void;
  onRemoveTrustedPath(path: string): void;
  onUnhidePort(port: number): void;
  onUnblockProcess(processName: string): void;
  onClearAudit(): void;
};

type ProfileFormState = {
  name: string;
  projectPath: string;
  startCommand: string;
  expectedPort: string;
  mainUrl: string;
  healthUrl: string;
  extraUrlLabel: string;
  extraUrl: string;
  preferredOpenMode: "tab" | "window";
  notes: string;
};

const emptyProfileFormState = (): ProfileFormState => ({
  name: "",
  projectPath: "",
  startCommand: "",
  expectedPort: "",
  mainUrl: "",
  healthUrl: "",
  extraUrlLabel: "",
  extraUrl: "",
  preferredOpenMode: "tab",
  notes: ""
});

const profileFormState = (profile: ProjectProfile): ProfileFormState => ({
  name: profile.name,
  projectPath: profile.projectPath ?? "",
  startCommand: profile.startCommand ?? "",
  expectedPort: profile.expectedPort ? String(profile.expectedPort) : "",
  mainUrl: profile.mainUrl ?? "",
  healthUrl: profile.healthUrl ?? "",
  extraUrlLabel: profile.extraUrls?.[0]?.label ?? "",
  extraUrl: profile.extraUrls?.[0]?.url ?? "",
  preferredOpenMode: profile.preferredOpenMode ?? "tab",
  notes: profile.notes ?? ""
});

const auditActionLabels: Record<ActionAuditKind, string> = {
  "start-profile": "Started profile",
  "start-workspace": "Started workspace",
  "stop-process": "Stopped process",
  "browser-cleanup": "Cleaned browser data",
  "open-private-window": "Opened private window"
};

const formatAuditEntry = (entry: ActionAuditEntry): string => {
  const detail = entry.detail ? ` - ${entry.detail}` : "";
  return `${auditActionLabels[entry.action]}${detail}`;
};

export const SettingsManager = ({
  settings,
  saving = false,
  onSaveProfile,
  onRemoveProfile,
  onRemoveWorkspace,
  onRemoveTrustedRoot,
  onRemoveTrustedPath,
  onUnhidePort,
  onUnblockProcess,
  onClearAudit
}: SettingsManagerProps) => {
  const [profileFormOpen, setProfileFormOpen] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [profileForm, setProfileForm] = useState<ProfileFormState>(() => emptyProfileFormState());
  const editingProfile = useMemo(
    () => settings.projectProfiles.find((profile) => profile.id === editingProfileId),
    [editingProfileId, settings.projectProfiles]
  );
  const trustedPaths = [
    ...settings.trustedProjectRoots.map((path) => ({ key: `root-${path}`, kind: "root" as const, path })),
    ...settings.trustedProjectPaths.map((path) => ({ key: `path-${path}`, kind: "path" as const, path }))
  ];
  const itemCount =
    settings.projectProfiles.length +
    settings.projectWorkspaces.length +
    settings.trustedProjectRoots.length +
    settings.trustedProjectPaths.length +
    settings.hiddenPorts.length +
    settings.blockedProcessNames.length +
    settings.actionAudit.length;

  const updateProfileField = (field: keyof ProfileFormState, value: string) => {
    setProfileForm((current) => ({ ...current, [field]: value }));
  };

  const openNewProfileForm = () => {
    setEditingProfileId(null);
    setProfileForm(emptyProfileFormState());
    setProfileFormOpen(true);
  };

  const openEditProfileForm = (profile: ProjectProfile) => {
    setEditingProfileId(profile.id);
    setProfileForm(profileFormState(profile));
    setProfileFormOpen(true);
  };

  const cancelProfileForm = () => {
    setProfileFormOpen(false);
    setEditingProfileId(null);
    setProfileForm(emptyProfileFormState());
  };

  const submitProfileForm = async () => {
    const name = profileForm.name.trim();
    if (!name) return;

    const profile: ProjectProfile = {
      ...editingProfile,
      id: editingProfile?.id ?? uniqueLocalId(name, settings.projectProfiles.map((profile) => profile.id)),
      name
    };
    delete profile.projectPath;
    delete profile.startCommand;
    delete profile.expectedPort;
    delete profile.mainUrl;
    delete profile.healthUrl;
    delete profile.preferredOpenMode;
    delete profile.extraUrls;
    delete profile.notes;

    const projectPath = profileForm.projectPath.trim();
    const startCommand = profileForm.startCommand.trim();
    const expectedPort = Number(profileForm.expectedPort);
    const mainUrl = profileForm.mainUrl.trim();
    const healthUrl = profileForm.healthUrl.trim();
    const notes = profileForm.notes.trim();
    const extraUrlLabel = profileForm.extraUrlLabel.trim();
    const extraUrl = profileForm.extraUrl.trim();
    const extraUrlTail = editingProfile?.extraUrls?.slice(1) ?? [];

    if (projectPath) profile.projectPath = projectPath;
    if (startCommand) profile.startCommand = startCommand;
    if (Number.isInteger(expectedPort) && expectedPort > 0 && expectedPort <= 65535) profile.expectedPort = expectedPort;
    if (mainUrl) profile.mainUrl = mainUrl;
    if (healthUrl) profile.healthUrl = healthUrl;
    if (profileForm.preferredOpenMode === "window") profile.preferredOpenMode = "window";
    if (extraUrlLabel && extraUrl) profile.extraUrls = [{ label: extraUrlLabel, url: extraUrl }, ...extraUrlTail];
    else if (extraUrlTail.length) profile.extraUrls = extraUrlTail;
    if (notes) profile.notes = notes;

    if (await onSaveProfile(profile)) {
      setProfileFormOpen(false);
      setEditingProfileId(null);
    }
  };

  return (
    <section id="settings-manager" className="settings-manager" aria-label="Settings manager" tabIndex={-1}>
      <div className="settings-manager-heading">
        <strong>Saved configuration</strong>
        <span>{itemCount} saved items</span>
      </div>
      <div className="settings-manager-grid">
        <div className="settings-manager-group">
          <div className="settings-manager-section-heading">
            <span className="settings-manager-label">Profiles</span>
            <button type="button" disabled={saving} onClick={openNewProfileForm} aria-label="Add profile">
              Add
            </button>
          </div>
          {profileFormOpen ? (
            <form
              className="settings-manager-profile-form"
              aria-label={editingProfile ? `Edit profile ${editingProfile.name}` : "New profile"}
              onSubmit={(event) => {
                event.preventDefault();
                void submitProfileForm();
              }}
            >
              <label>
                <span>Profile name</span>
                <input
                  aria-label="Profile name"
                  value={profileForm.name}
                  onChange={(event) => updateProfileField("name", event.target.value)}
                  disabled={saving}
                  required
                />
              </label>
              <label>
                <span>Project path</span>
                <input
                  aria-label="Project path"
                  value={profileForm.projectPath}
                  onChange={(event) => updateProfileField("projectPath", event.target.value)}
                  disabled={saving}
                />
              </label>
              <label>
                <span>Start command</span>
                <input
                  aria-label="Start command"
                  value={profileForm.startCommand}
                  onChange={(event) => updateProfileField("startCommand", event.target.value)}
                  disabled={saving}
                />
              </label>
              <div className="settings-manager-form-row">
                <label>
                  <span>Expected port</span>
                  <input
                    aria-label="Expected port"
                    inputMode="numeric"
                    value={profileForm.expectedPort}
                    onChange={(event) => updateProfileField("expectedPort", event.target.value)}
                    disabled={saving}
                  />
                </label>
                <label>
                  <span>Open mode</span>
                  <select
                    aria-label="Open mode"
                    value={profileForm.preferredOpenMode}
                    onChange={(event) => updateProfileField("preferredOpenMode", event.target.value)}
                    disabled={saving}
                  >
                    <option value="tab">tab</option>
                    <option value="window">window</option>
                  </select>
                </label>
              </div>
              <label>
                <span>Main URL</span>
                <input
                  aria-label="Main URL"
                  value={profileForm.mainUrl}
                  onChange={(event) => updateProfileField("mainUrl", event.target.value)}
                  disabled={saving}
                />
              </label>
              <label>
                <span>Health URL</span>
                <input
                  aria-label="Health URL"
                  value={profileForm.healthUrl}
                  onChange={(event) => updateProfileField("healthUrl", event.target.value)}
                  disabled={saving}
                />
              </label>
              <div className="settings-manager-form-row">
                <label>
                  <span>Extra URL label</span>
                  <input
                    aria-label="Extra URL label"
                    value={profileForm.extraUrlLabel}
                    onChange={(event) => updateProfileField("extraUrlLabel", event.target.value)}
                    disabled={saving}
                  />
                </label>
                <label>
                  <span>Extra URL</span>
                  <input
                    aria-label="Extra URL"
                    value={profileForm.extraUrl}
                    onChange={(event) => updateProfileField("extraUrl", event.target.value)}
                    disabled={saving}
                  />
                </label>
              </div>
              <label>
                <span>Profile notes</span>
                <textarea
                  aria-label="Profile notes"
                  value={profileForm.notes}
                  onChange={(event) => updateProfileField("notes", event.target.value)}
                  disabled={saving}
                />
              </label>
              <div className="settings-manager-form-actions">
                <button type="submit" disabled={saving || !profileForm.name.trim()} aria-label="Save profile">
                  Save
                </button>
                <button type="button" disabled={saving} onClick={cancelProfileForm}>
                  Cancel
                </button>
              </div>
            </form>
          ) : null}
          {settings.projectProfiles.length ? (
            settings.projectProfiles.map((profile) => (
              <div className="settings-manager-row" key={profile.id}>
                <span>
                  <strong>{profile.name}</strong>
                  <small>{profile.projectPath ?? profile.mainUrl ?? `Port ${profile.expectedPort ?? "unknown"}`}</small>
                </span>
                <div className="settings-manager-row-actions">
                  <button
                    className="settings-manager-neutral"
                    type="button"
                    disabled={saving}
                    onClick={() => openEditProfileForm(profile)}
                    aria-label={`Edit profile ${profile.name}`}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => onRemoveProfile(profile.id, profile.name)}
                    aria-label={`Remove profile ${profile.name}`}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))
          ) : (
            <span className="settings-manager-empty">No saved profiles</span>
          )}
        </div>
        <div className="settings-manager-group">
          <span className="settings-manager-label">Workspaces</span>
          {settings.projectWorkspaces.length ? (
            settings.projectWorkspaces.map((workspace) => (
              <div className="settings-manager-row" key={workspace.id}>
                <span>
                  <strong>{workspace.name}</strong>
                  <small>{workspace.profileIds.length} profiles</small>
                </span>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => onRemoveWorkspace(workspace.id, workspace.name)}
                  aria-label={`Remove workspace ${workspace.name}`}
                >
                  Remove
                </button>
              </div>
            ))
          ) : (
            <span className="settings-manager-empty">No saved workspaces</span>
          )}
        </div>
        <div className="settings-manager-group">
          <span className="settings-manager-label">Trusted Paths</span>
          {trustedPaths.length ? (
            trustedPaths.map(({ key, kind, path }) => (
              <div className="settings-manager-row" key={key}>
                <span>
                  <strong>{path}</strong>
                </span>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    if (kind === "root") {
                      onRemoveTrustedRoot(path);
                      return;
                    }
                    onRemoveTrustedPath(path);
                  }}
                  aria-label={`Remove trusted path ${path}`}
                >
                  Remove
                </button>
              </div>
            ))
          ) : (
            <span className="settings-manager-empty">No trusted paths</span>
          )}
        </div>
        <div className="settings-manager-group">
          <span className="settings-manager-label">Hidden Ports</span>
          {settings.hiddenPorts.length ? (
            settings.hiddenPorts.map((port) => (
              <div className="settings-manager-row" key={port}>
                <span>
                  <strong>{port}</strong>
                </span>
                <button type="button" disabled={saving} onClick={() => onUnhidePort(port)} aria-label={`Unhide port ${port}`}>
                  Unhide
                </button>
              </div>
            ))
          ) : (
            <span className="settings-manager-empty">No hidden ports</span>
          )}
        </div>
        <div className="settings-manager-group">
          <span className="settings-manager-label">Blocked Processes</span>
          {settings.blockedProcessNames.length ? (
            settings.blockedProcessNames.map((processName) => (
              <div className="settings-manager-row" key={processName}>
                <span>
                  <strong>{processName}</strong>
                </span>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => onUnblockProcess(processName)}
                  aria-label={`Unblock process ${processName}`}
                >
                  Unblock
                </button>
              </div>
            ))
          ) : (
            <span className="settings-manager-empty">No blocked processes</span>
          )}
        </div>
        <div className="settings-manager-group">
          <span className="settings-manager-label">Recent Actions</span>
          {settings.actionAudit.length ? (
            <>
              <div className="settings-manager-row">
                <span>
                  <strong>{settings.actionAudit.length} recorded actions</strong>
                </span>
                <button type="button" disabled={saving} onClick={onClearAudit} aria-label="Clear action audit">
                  Clear
                </button>
              </div>
              {settings.actionAudit
                .slice()
                .reverse()
                .slice(0, 6)
                .map((entry) => (
                  <div className="settings-manager-row" key={entry.id}>
                    <span>
                      <strong>{entry.target}</strong>
                      <small>{formatAuditEntry(entry)}</small>
                    </span>
                  </div>
                ))}
            </>
          ) : (
            <span className="settings-manager-empty">No recent actions</span>
          )}
        </div>
      </div>
    </section>
  );
};
