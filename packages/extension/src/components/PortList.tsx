import { AlertTriangle, LockKeyhole, Square, Terminal, X } from "lucide-react";
import { kindLabel, type PortEntry } from "@localhost-control/shared";
import { IconButton } from "./IconButton";

type PortListProps = {
  entries: PortEntry[];
  selectedPort: number | undefined;
  onSelect(entry: PortEntry): void;
  onKill(entry: PortEntry): void;
};

const healthClass = (entry: PortEntry): string => {
  if (!entry.killable) return "locked";
  if (entry.statusCode && entry.statusCode < 400) return "healthy";
  if (entry.confidence === "high") return "active";
  return "unknown";
};

export const PortList = ({ entries, selectedPort, onSelect, onKill }: PortListProps) => (
  <div className="port-list" aria-label="Detected localhost ports">
    {entries.map((entry) => (
      <div className={`port-row ${selectedPort === entry.port ? "selected" : ""}`} key={`${entry.pid}-${entry.port}`}>
        <button className="port-main" type="button" aria-label={`Select port ${entry.port}`} onClick={() => onSelect(entry)}>
          <span className={`health ${healthClass(entry)}`} />
          <span className="port-number">{entry.port}</span>
          <span className="port-copy">
            <span className="port-title">{entry.title ?? entry.projectHint?.split(/[\\/]/).pop() ?? kindLabel(entry.detectedKind)}</span>
            <span className="port-meta">
              <span>{kindLabel(entry.detectedKind)}</span>
              <span>{entry.processName}</span>
              <span>PID {entry.pid}</span>
            </span>
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
          <IconButton label={`Kill port ${entry.port}`} tone="danger" onClick={() => onKill(entry)} disabled={!entry.killable}>
            <X size={16} />
          </IconButton>
        </div>
      </div>
    ))}
  </div>
);
