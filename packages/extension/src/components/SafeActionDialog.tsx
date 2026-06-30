import { useEffect, useRef, type KeyboardEvent } from "react";
import { AlertTriangle } from "lucide-react";
import type { PortEntry } from "@localhost-control/shared";
import type { ProjectProfile } from "../lib/projectProfiles";
import { formatCpu, formatMemory, formatUptime } from "../lib/resources";

type SafeActionDialogProps = {
  entry: PortEntry;
  profile?: ProjectProfile | undefined;
  action?: "stop" | "restart";
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

export const SafeActionDialog = ({ entry, profile, action = "stop", onCancel, onConfirm }: SafeActionDialogProps) => {
  const label = profile?.name ?? entry.title ?? `${entry.processName} on ${entry.port}`;
  const title = action === "restart" ? `Restart ${label}` : `Stop ${label}`;
  const description =
    action === "restart" ? "Review the process context before stopping and starting it again." : "Review the process context before forcing it to close.";
  const confirmLabel = action === "restart" ? "Restart" : "Force stop";
  const cpu = formatCpu(entry.resources);
  const memory = formatMemory(entry.resources?.memoryBytes);
  const uptime = formatUptime(entry.resources);
  const dialogRef = useRef<HTMLElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  const keepFocusInDialog = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }

    if (event.key !== "Tab") return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? []);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="dialog-backdrop">
      <section ref={dialogRef} className="safe-dialog" role="dialog" aria-modal="true" aria-label={title} onKeyDown={keepFocusInDialog}>
        <div className="safe-dialog-heading">
          <AlertTriangle size={19} />
          <div>
            <h2>{title}?</h2>
            <p>{description}</p>
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
          <button ref={cancelRef} type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="danger-command" type="button" onClick={() => onConfirm(entry)}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
};
