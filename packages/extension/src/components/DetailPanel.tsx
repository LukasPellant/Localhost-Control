import { Copy, EyeOff, ExternalLink, FolderPlus, Power, Terminal } from "lucide-react";
import { kindLabel, type PortEntry } from "@localhost-control/shared";
import { IconButton } from "./IconButton";
import { formatCpu, formatMemory, formatUptime } from "../lib/resources";

type DetailPanelProps = {
  entry: PortEntry | undefined;
  onKill(entry: PortEntry): void;
  onOpen(entry: PortEntry): void;
  onCopy(entry: PortEntry): void;
  onTerminal(entry: PortEntry): void;
  onTrustProject(entry: PortEntry): void;
  onHideProcess(entry: PortEntry): void;
};

export const DetailPanel = ({ entry, onKill, onOpen, onCopy, onTerminal, onTrustProject, onHideProcess }: DetailPanelProps) => {
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
      <div className="detail-rule-actions">
        <button type="button" onClick={() => onTrustProject(entry)} disabled={!entry.projectHint}>
          <FolderPlus size={14} />
          Trust project
        </button>
        <button type="button" onClick={() => onHideProcess(entry)}>
          <EyeOff size={14} />
          Hide process
        </button>
      </div>
      <code className="kill-command">taskkill /PID {entry.pid} /T /F</code>
    </section>
  );
};
