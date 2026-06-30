import { Activity, Copy, EyeOff, ExternalLink, FolderPlus, Power, Terminal, Trash2 } from "lucide-react";
import { kindLabel, type PortEntry } from "@localhost-control/shared";
import { IconButton } from "./IconButton";
import type { PortDoctorReport } from "../lib/portDoctor";
import type { ProfileHealthResult } from "../lib/profileHealth";
import type { ProjectProfile } from "../lib/projectProfiles";
import { formatCpu, formatMemory, formatUptime } from "../lib/resources";
import type { StaleProcessSignal } from "../lib/staleProcesses";

type DetailPanelProps = {
  entry: PortEntry | undefined;
  profile?: ProjectProfile | undefined;
  profileHealth?: ProfileHealthResult | undefined;
  doctorReport?: PortDoctorReport | undefined;
  staleSignal?: StaleProcessSignal | undefined;
  onKill(entry: PortEntry): void;
  onOpen(entry: PortEntry): void;
  onCopy(entry: PortEntry): void;
  onTerminal(entry: PortEntry): void;
  onCleanup(entry: PortEntry): void;
  onCheckProfileHealth(profile: ProjectProfile): void;
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
  onKill,
  onOpen,
  onCopy,
  onTerminal,
  onCleanup,
  onCheckProfileHealth,
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
          <IconButton label={`Clean browser data for port ${entry.port}`} onClick={() => onCleanup(entry)}>
            <Trash2 size={15} />
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
          <dd>{entry.url ?? `http://127.0.0.1:${entry.port}`}</dd>
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
        {profile?.healthUrl ? (
          <div className="wide">
            <dt>Health URL</dt>
            <dd>{profile.healthUrl}</dd>
          </div>
        ) : null}
        {profileHealth ? (
          <div className="wide">
            <dt>Health status</dt>
            <dd>{profileHealth.label}</dd>
          </div>
        ) : null}
        {profile?.notes ? (
          <div className="wide">
            <dt>Notes</dt>
            <dd>{profile.notes}</dd>
          </div>
        ) : null}
      </dl>
      {staleSignal ? (
        <div className={`stale-signal ${staleSignal.severity}`} aria-label="Stale process signal">
          <strong>{staleSignal.label}</strong>
          <span>{staleSignal.reasons.join(" / ")}</span>
        </div>
      ) : null}
      {doctorReport && doctorReport.status !== "ok" ? (
        <div className={`doctor-card ${doctorReport.status}`} aria-label="Port doctor">
          <strong>{doctorReport.summary}</strong>
          <span>{doctorReport.nextFreePort ? `Next free: ${doctorReport.nextFreePort}` : "No free port found"}</span>
          {doctorReport.issues.map((issue) => (
            <span key={issue}>{issue}</span>
          ))}
        </div>
      ) : null}
      {profile?.extraUrls?.length ? (
        <div className="profile-links" aria-label="Profile URLs">
          {profile.extraUrls.map((item) => (
            <a key={`${item.label}-${item.url}`} href={item.url} target="_blank" rel="noreferrer">
              {item.label}
            </a>
          ))}
        </div>
      ) : null}
      {profile?.logLines?.length ? (
        <div className="log-preview" aria-label="Recent logs">
          <strong>Recent logs</strong>
          {profile.logLines.slice(-4).map((line, index) => (
            <code key={`${index}-${line}`}>{line}</code>
          ))}
        </div>
      ) : null}
      <div className="detail-rule-actions">
        {profile?.healthUrl ? (
          <button type="button" onClick={() => onCheckProfileHealth(profile)} aria-label={`Check health for ${profile.name}`}>
            <Activity size={14} />
            Check health
          </button>
        ) : null}
        <button type="button" onClick={() => onSaveProfile(entry)} disabled={Boolean(profile)}>
          <FolderPlus size={14} />
          Save profile
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
