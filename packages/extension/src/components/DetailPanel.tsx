import { Activity, Copy, EyeOff, ExternalLink, FolderOpen, FolderPlus, Monitor, Power, RefreshCw, Smartphone, Tablet, Terminal, Trash2 } from "lucide-react";
import { kindLabel, type PortEntry } from "@localhost-control/shared";
import { IconButton } from "./IconButton";
import { originFromLocalhostUrl, type BrowserCleanupMode, type BrowserPreviewPreset } from "../lib/browserCleanup";
import type { PortDoctorReport } from "../lib/portDoctor";
import type { ProfileHealthResult } from "../lib/profileHealth";
import type { ProjectProfile } from "../lib/projectProfiles";
import { recentProfileLogLines } from "../lib/profileLogs";
import { formatCpu, formatMemory, formatUptime } from "../lib/resources";
import type { StaleProcessSignal } from "../lib/staleProcesses";

type DetailPanelProps = {
  entry: PortEntry | undefined;
  profile?: ProjectProfile | undefined;
  profileHealth?: ProfileHealthResult | undefined;
  doctorReport?: PortDoctorReport | undefined;
  staleSignal?: StaleProcessSignal | undefined;
  projectFolderPath?: string | undefined;
  onKill(entry: PortEntry): void;
  onOpen(entry: PortEntry): void;
  onCopy(entry: PortEntry): void;
  onCopyDevContext(entry: PortEntry): void;
  onCopyProfileLogs(profile: ProjectProfile): void;
  onTerminal(entry: PortEntry): void;
  onCleanup(entry: PortEntry, mode?: BrowserCleanupMode): void;
  onHardReload(entry: PortEntry): void;
  onOpenPrivate(entry: PortEntry): void;
  onOpenMobilePreview(entry: PortEntry, preset: BrowserPreviewPreset): void;
  onOpenProjectFolder(entry: PortEntry): void;
  onCopyProfileCommand(profile: ProjectProfile): void;
  onOpenProfileTerminal(profile: ProjectProfile): void;
  onCheckProfileHealth(profile: ProjectProfile): void;
  onCopyDoctorAdvice(entry: PortEntry, report: PortDoctorReport): void;
  onCopyStaleAdvice(entry: PortEntry, signal: StaleProcessSignal): void;
  onSaveProfile(entry: PortEntry): void;
  onTrustProject(entry: PortEntry): void;
  onHideProcess(entry: PortEntry): void;
};

export const DetailPanel = ({
  entry,
  profile,
  profileHealth,
  doctorReport,
  staleSignal,
  projectFolderPath,
  onKill,
  onOpen,
  onCopy,
  onCopyDevContext,
  onCopyProfileLogs,
  onTerminal,
  onCleanup,
  onHardReload,
  onOpenPrivate,
  onOpenMobilePreview,
  onOpenProjectFolder,
  onCopyProfileCommand,
  onOpenProfileTerminal,
  onCheckProfileHealth,
  onCopyDoctorAdvice,
  onCopyStaleAdvice,
  onSaveProfile,
  onTrustProject,
  onHideProcess
}: DetailPanelProps) => {
  if (!entry) {
    return (
      <section className="detail-panel empty-detail">
        <span>No port selected</span>
      </section>
    );
  }

  const cpu = formatCpu(entry.resources);
  const memory = formatMemory(entry.resources?.memoryBytes);
  const privateMemory = formatMemory(entry.resources?.privateMemoryBytes, "private");
  const uptime = formatUptime(entry.resources);
  const entryUrl = entry.url ?? `http://127.0.0.1:${entry.port}`;
  const cleanupOrigin = (() => {
    try {
      return originFromLocalhostUrl(entryUrl);
    } catch {
      return undefined;
    }
  })();
  const showDevHealth =
    Boolean(profile) ||
    Boolean(profileHealth) ||
    Boolean(cleanupOrigin) ||
    Boolean(doctorReport && doctorReport.status !== "ok") ||
    Boolean(staleSignal) ||
    Boolean(projectFolderPath);
  const recentLogs = recentProfileLogLines(profile);
  const projectFolderLabel = profile ? `Open project folder for ${profile.name}` : `Open project folder for port ${entry.port}`;
  const canUpdateProfile = Boolean(profile && (entry.projectHint || entry.commandLine) && (!profile.projectPath || !profile.startCommand));
  const saveProfileLabel = profile ? "Update profile" : "Save profile";

  return (
    <section className="detail-panel" aria-label={`Port ${entry.port} details`}>
      <div className="detail-heading">
        <div>
          <span className="detail-port">{entry.port}</span>
          <span className="detail-kind">{kindLabel(entry.detectedKind)}</span>
        </div>
        <div className="detail-actions">
          <IconButton label={`Open port ${entry.port}`} onClick={() => onOpen(entry)}>
            <ExternalLink size={15} />
          </IconButton>
          <IconButton label={`Copy URL for port ${entry.port}`} onClick={() => onCopy(entry)}>
            <Copy size={15} />
          </IconButton>
          <IconButton label={`Open terminal for port ${entry.port}`} onClick={() => onTerminal(entry)}>
            <Terminal size={15} />
          </IconButton>
          <IconButton label={`Kill port ${entry.port}`} tone="danger" onClick={() => onKill(entry)} disabled={!entry.killable}>
            <Power size={15} />
          </IconButton>
        </div>
      </div>
      <dl className="detail-grid">
        {profile ? (
          <div>
            <dt>Profile</dt>
            <dd>{profile.name}</dd>
          </div>
        ) : null}
        <div>
          <dt>URL</dt>
          <dd>{entryUrl}</dd>
        </div>
        <div>
          <dt>PID</dt>
          <dd>{entry.pid}</dd>
        </div>
        <div>
          <dt>Process</dt>
          <dd>{entry.processName}</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd>{entry.confidence}</dd>
        </div>
        <div>
          <dt>CPU</dt>
          <dd>{cpu ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Memory</dt>
          <dd>{memory ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Private</dt>
          <dd>{privateMemory ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Threads</dt>
          <dd>{entry.resources?.threadCount ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Handles</dt>
          <dd>{entry.resources?.handleCount ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Uptime</dt>
          <dd>{uptime ?? "Unknown"}</dd>
        </div>
        <div className="wide">
          <dt>Path</dt>
          <dd>{entry.projectHint ?? entry.executablePath ?? "Unknown"}</dd>
        </div>
        <div className="wide">
          <dt>Command</dt>
          <dd>{entry.commandLine ?? entry.protectionReason ?? "No command line available"}</dd>
        </div>
      </dl>
      {showDevHealth ? (
        <div className="dev-health-card" aria-label={profile ? `Dev health for ${profile.name}` : `Dev health for port ${entry.port}`}>
          <div className="dev-health-heading">
            <div>
              <strong>Dev health</strong>
              <span>{profile?.name ?? `Port ${entry.port}`}</span>
            </div>
            {profileHealth ? <span className={`dev-health-status ${profileHealth.state}`}>{profileHealth.label}</span> : null}
          </div>
          <dl className="dev-health-grid">
            {profile?.healthUrl || profileHealth ? (
              <div>
                <dt>Health</dt>
                <dd>{profileHealth?.label ?? "Not checked"}</dd>
              </div>
            ) : null}
            {profile?.healthUrl ? (
              <div>
                <dt>Health URL</dt>
                <dd>{profile.healthUrl}</dd>
              </div>
            ) : null}
            {cleanupOrigin ? (
              <div>
                <dt>Origin</dt>
                <dd>{cleanupOrigin}</dd>
              </div>
            ) : null}
            {profile?.startCommand ? (
              <div>
                <dt>Saved command</dt>
                <dd>{profile.startCommand}</dd>
              </div>
            ) : null}
            {profile?.notes ? (
              <div>
                <dt>Notes</dt>
                <dd>{profile.notes}</dd>
              </div>
            ) : null}
            {doctorReport && doctorReport.status !== "ok" ? (
              <div className={doctorReport.status === "conflict" ? "danger" : "attention"}>
                <dt>Doctor</dt>
                <dd>
                  {doctorReport.summary}
                  {" / "}
                  {doctorReport.nextFreePort ? `Next free: ${doctorReport.nextFreePort}` : "No free port found"}
                  {doctorReport.issues.length ? ` / ${doctorReport.issues.join(" / ")}` : ""}
                  {doctorReport.advice.length ? (
                    <span className="doctor-advice">
                      {doctorReport.advice.map((item) => (
                        <span key={item}>{item}</span>
                      ))}
                    </span>
                  ) : null}
                </dd>
              </div>
            ) : null}
            {staleSignal ? (
              <div className={staleSignal.severity === "high" ? "danger" : "attention"}>
                <dt>Stale</dt>
                <dd>
                  {staleSignal.label}
                  {" / "}
                  {staleSignal.reasons.join(" / ")}
                  {staleSignal.advice.length ? (
                    <span className="stale-advice">
                      {staleSignal.advice.map((item) => (
                        <span key={item}>{item}</span>
                      ))}
                    </span>
                  ) : null}
                </dd>
              </div>
            ) : null}
          </dl>
          <div className="dev-health-actions">
            {profile?.healthUrl ? (
              <button type="button" onClick={() => onCheckProfileHealth(profile)} aria-label={`Check health for ${profile.name}`}>
                <Activity size={14} />
                Check health
              </button>
            ) : null}
            {cleanupOrigin ? (
              <>
                <button type="button" onClick={() => onCleanup(entry)} aria-label={`Clean app origin ${cleanupOrigin}`}>
                  <Trash2 size={14} />
                  Clean app origin
                </button>
                <button type="button" onClick={() => onCleanup(entry, "cache")} aria-label={`Reset app cache ${cleanupOrigin}`}>
                  <RefreshCw size={14} />
                  Reset cache
                </button>
                <button type="button" onClick={() => onHardReload(entry)} aria-label={`Hard reload tabs ${cleanupOrigin}`}>
                  <RefreshCw size={14} />
                  Hard reload
                </button>
                <button type="button" onClick={() => onOpenPrivate(entry)} aria-label={`Open private window ${cleanupOrigin}`}>
                  <EyeOff size={14} />
                  Open private
                </button>
                <button type="button" onClick={() => onOpenMobilePreview(entry, "phone")} aria-label={`Open phone preview ${cleanupOrigin}`}>
                  <Smartphone size={14} />
                  Phone
                </button>
                <button type="button" onClick={() => onOpenMobilePreview(entry, "tablet")} aria-label={`Open tablet preview ${cleanupOrigin}`}>
                  <Tablet size={14} />
                  Tablet
                </button>
                <button type="button" onClick={() => onOpenMobilePreview(entry, "desktop")} aria-label={`Open desktop preview ${cleanupOrigin}`}>
                  <Monitor size={14} />
                  Desktop
                </button>
              </>
            ) : null}
            <button type="button" onClick={() => onCopyDevContext(entry)} aria-label={`Copy dev context for ${profile?.name ?? `port ${entry.port}`}`}>
              <Copy size={14} />
              Copy dev context
            </button>
            {projectFolderPath ? (
              <button type="button" onClick={() => onOpenProjectFolder(entry)} aria-label={projectFolderLabel}>
                <FolderOpen size={14} />
                Open folder
              </button>
            ) : null}
            {profile && recentLogs.length ? (
              <button type="button" onClick={() => onCopyProfileLogs(profile)} aria-label={`Copy logs for ${profile.name}`}>
                <Copy size={14} />
                Copy logs
              </button>
            ) : null}
            {doctorReport && doctorReport.status !== "ok" && doctorReport.advice.length ? (
              <button type="button" onClick={() => onCopyDoctorAdvice(entry, doctorReport)} aria-label={`Copy doctor advice for port ${entry.port}`}>
                <Copy size={14} />
                Copy doctor advice
              </button>
            ) : null}
            {staleSignal?.advice.length ? (
              <>
                <button
                  type="button"
                  onClick={() => onKill(entry)}
                  aria-label={`Review stop for ${staleSignal.label.toLowerCase()} on port ${entry.port}`}
                >
                  <Power size={14} />
                  Review stop
                </button>
                <button
                  type="button"
                  onClick={() => onCopyStaleAdvice(entry, staleSignal)}
                  aria-label={`Copy stale advice for port ${entry.port}`}
                >
                  <Copy size={14} />
                  Copy stale advice
                </button>
              </>
            ) : null}
            {profile?.startCommand ? (
              <>
                <button type="button" onClick={() => onCopyProfileCommand(profile)} aria-label={`Copy command for ${profile.name}`}>
                  <Copy size={14} />
                  Copy command
                </button>
                <button type="button" onClick={() => onOpenProfileTerminal(profile)} aria-label={`Open terminal for ${profile.name}`}>
                  <Terminal size={14} />
                  Open terminal in project
                </button>
              </>
            ) : null}
          </div>
          {profile?.extraUrls?.length ? (
            <div className="dev-health-links" aria-label="Profile URLs">
              {profile.extraUrls.map((item) => (
                <a key={`${item.label}-${item.url}`} href={item.url} target="_blank" rel="noreferrer">
                  {item.label}
                </a>
              ))}
            </div>
          ) : null}
          {recentLogs.length ? (
            <div className="dev-health-logs" aria-label="Recent profile logs">
              <strong>Recent profile logs</strong>
              {recentLogs.map((line, index) => (
                <code className={line.severity} key={`${index}-${line.text}`}>
                  {line.text}
                </code>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="detail-rule-actions">
        <button type="button" onClick={() => onSaveProfile(entry)} disabled={Boolean(profile) && !canUpdateProfile}>
          <FolderPlus size={14} />
          {saveProfileLabel}
        </button>
        <button type="button" onClick={() => onTrustProject(entry)} disabled={!entry.projectHint}>
          <FolderPlus size={14} />
          Trust project
        </button>
        <button type="button" onClick={() => onHideProcess(entry)}>
          <EyeOff size={14} />
          Hide process
        </button>
      </div>
    </section>
  );
};
