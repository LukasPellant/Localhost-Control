import { AlertTriangle, ExternalLink, LockKeyhole, Square, Terminal, X } from "lucide-react";
import { kindLabel, type PortEntry } from "@localhost-control/shared";
import { IconButton } from "./IconButton";
import { compactResourceLabels } from "../lib/resources";

type PortListProps = {
  entries: PortEntry[];
  selectedKey: string | null;
  profileNameForEntry?(entry: PortEntry): string | undefined;
  onSelect(entry: PortEntry): void;
  onOpen(entry: PortEntry): void;
  onKill(entry: PortEntry): void;
};

const healthClass = (entry: PortEntry): string => {
  if (!entry.killable) return "locked";
  if (entry.statusCode && entry.statusCode < 400) return "healthy";
  if (entry.confidence === "high") return "active";
  return "unknown";
};

const ResourceStrip = ({ entry }: { entry: PortEntry }) => {
  const labels = compactResourceLabels(entry.resources);
  if (!labels.length) return null;

  return (
    <span className="port-resources">
      {labels.map((label) => (
        <span key={label}>{label}</span>
      ))}
    </span>
  );
};

export const PortList = ({ entries, selectedKey, profileNameForEntry, onSelect, onOpen, onKill }: PortListProps) => (
  <div className="port-list" aria-label="Detected localhost ports">
    {entries.map((entry) => {
      const profileName = profileNameForEntry?.(entry);
      return (
        <div className={`port-row ${selectedKey === `${entry.pid}:${entry.port}` ? "selected" : ""}`} key={`${entry.pid}-${entry.port}`}>
          <button className="port-main" type="button" aria-label={`Select port ${entry.port}`} onClick={() => onSelect(entry)}>
            <span className={`health ${healthClass(entry)}`} />
            <span className="port-number">{entry.port}</span>
            <span className="port-copy">
              <span className="port-title">{profileName ?? entry.title ?? entry.projectHint?.split(/[\\/]/).pop() ?? kindLabel(entry.detectedKind)}</span>
              <span className="port-meta">
                {profileName ? <span>Profile</span> : null}
                <span>{kindLabel(entry.detectedKind)}</span>
                <span>{entry.processName}</span>
                <span>PID {entry.pid}</span>
              </span>
              <ResourceStrip entry={entry} />
              <span className="port-path">{entry.projectHint ?? entry.commandLine ?? entry.address}</span>
            </span>
          </button>
          <div className="row-tools">
            {!entry.killable ? (
              <LockKeyhole size={15} aria-label="Protected" />
            ) : entry.confidence === "low" ? (
              <AlertTriangle size={15} aria-label="Low confidence" />
            ) : entry.detectedKind === "python" ? (
              <Terminal size={15} aria-label="Python process" />
            ) : (
              <Square size={14} aria-label="Dev process" />
            )}
            <IconButton label={`Open port ${entry.port}`} onClick={() => onOpen(entry)}>
              <ExternalLink size={15} />
            </IconButton>
            <IconButton label={`Kill port ${entry.port}`} tone="danger" onClick={() => onKill(entry)} disabled={!entry.killable}>
              <X size={16} />
            </IconButton>
          </div>
        </div>
      );
    })}
  </div>
);
