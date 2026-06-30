import type { Settings } from "../lib/settings";
import type { ActionAuditEntry, ActionAuditKind } from "../lib/actionAudit";

type SettingsManagerProps = {
  settings: Settings;
  saving?: boolean;
  onRemoveProfile(profileId: string, name: string): void;
  onRemoveWorkspace(workspaceId: string, name: string): void;
  onRemoveTrustedRoot(path: string): void;
  onRemoveTrustedPath(path: string): void;
  onUnhidePort(port: number): void;
  onUnblockProcess(processName: string): void;
  onClearAudit(): void;
};

const auditActionLabels: Record<ActionAuditKind, string> = {
  "start-profile": "Started profile",
  "start-workspace": "Started workspace",
  "stop-process": "Stopped process",
  "browser-cleanup": "Cleaned browser data"
};

const formatAuditEntry = (entry: ActionAuditEntry): string => {
  const detail = entry.detail ? ` - ${entry.detail}` : "";
  return `${auditActionLabels[entry.action]}${detail}`;
};

export const SettingsManager = ({
  settings,
  saving = false,
  onRemoveProfile,
  onRemoveWorkspace,
  onRemoveTrustedRoot,
  onRemoveTrustedPath,
  onUnhidePort,
  onUnblockProcess,
  onClearAudit
}: SettingsManagerProps) => {
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

  return (
    <section id="settings-manager" className="settings-manager" aria-label="Settings manager" tabIndex={-1}>
      <div className="settings-manager-heading">
        <strong>Saved configuration</strong>
        <span>{itemCount} saved items</span>
      </div>
      <div className="settings-manager-grid">
        <div className="settings-manager-group">
          <span className="settings-manager-label">Profiles</span>
          {settings.projectProfiles.length ? (
            settings.projectProfiles.map((profile) => (
              <div className="settings-manager-row" key={profile.id}>
                <span>
                  <strong>{profile.name}</strong>
                  <small>{profile.projectPath ?? profile.mainUrl ?? `Port ${profile.expectedPort ?? "unknown"}`}</small>
                </span>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => onRemoveProfile(profile.id, profile.name)}
                  aria-label={`Remove profile ${profile.name}`}
                >
                  Remove
                </button>
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
