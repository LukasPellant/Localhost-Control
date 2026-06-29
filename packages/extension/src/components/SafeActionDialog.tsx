import { AlertTriangle } from "lucide-react";
import type { PortEntry } from "@localhost-control/shared";
import type { ProjectProfile } from "../lib/projectProfiles";
import { formatCpu, formatMemory, formatUptime } from "../lib/resources";

type SafeActionDialogProps = {
  entry: PortEntry;
  profile?: ProjectProfile | undefined;
  onCancel(): void;
  onConfirm(entry: PortEntry): void;
};

const detail = (label: string, value: string | number | undefined, className?: string) =>
  value === undefined || value === "" ? null : (
    <div className={className}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );

export const SafeActionDialog = ({ entry, profile, onCancel, onConfirm }: SafeActionDialogProps) => {
  const label = profile?.name ?? entry.title ?? `${entry.processName} on ${entry.port}`;
  const cpu = formatCpu(entry.resources);
  const memory = formatMemory(entry.resources?.memoryBytes);
  const uptime = formatUptime(entry.resources);

  return (
    <div className="dialog-backdrop">
      <section className="safe-dialog" role="dialog" aria-modal="true" aria-label={`Stop ${label}`}>
        <div className="safe-dialog-heading">
          <AlertTriangle size={19} />
          <div>
            <h2>Stop {label}?</h2>
            <p>Review the process context before forcing it to close.</p>
          </div>
        </div>
        <dl className="safe-dialog-grid">
          {detail("PID", entry.pid)}
          {detail("Port", entry.port)}
          {detail("Process", entry.processName)}
          {detail("Parent PID", entry.parentPid)}
          {detail("Project", profile?.name ?? entry.projectHint)}
          {detail("Path", entry.projectHint ?? entry.executablePath)}
          {detail("CPU", cpu)}
          {detail("Memory", memory)}
          {detail("Uptime", uptime)}
          {detail("Command", entry.commandLine, "wide")}
        </dl>
        <div className="safe-dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="danger-command" type="button" onClick={() => onConfirm(entry)}>
            Force stop
          </button>
        </div>
      </section>
    </div>
  );
};
