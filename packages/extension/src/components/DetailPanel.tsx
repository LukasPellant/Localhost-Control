import { Copy, ExternalLink, Power, Terminal } from "lucide-react";
import { kindLabel, type PortEntry } from "@localhost-control/shared";
import { IconButton } from "./IconButton";

type DetailPanelProps = {
  entry: PortEntry | undefined;
  onKill(entry: PortEntry): void;
  onOpen(entry: PortEntry): void;
  onCopy(entry: PortEntry): void;
  onTerminal(entry: PortEntry): void;
};

export const DetailPanel = ({ entry, onKill, onOpen, onCopy, onTerminal }: DetailPanelProps) => {
  if (!entry) {
    return (
      <section className="detail-panel empty-detail">
        <span>No port selected</span>
      </section>
    );
  }

  return (
    <section className="detail-panel" aria-label={`Port ${entry.port} details`}>
      <div className="detail-heading">
        <div>
          <span className="detail-port">{entry.port}</span>
          <span className="detail-kind">{kindLabel(entry.detectedKind)}</span>
        </div>
        <div className="detail-actions">
          <IconButton label={`Open port ${entry.port}`} onClick={() => onOpen(entry)} disabled={!entry.url}>
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
        <div className="wide">
          <dt>Path</dt>
          <dd>{entry.projectHint ?? entry.executablePath ?? "Unknown"}</dd>
        </div>
        <div className="wide">
          <dt>Command</dt>
          <dd>{entry.commandLine ?? entry.protectionReason ?? "No command line available"}</dd>
        </div>
      </dl>
      <code className="kill-command">taskkill /PID {entry.pid} /T /F</code>
    </section>
  );
};
