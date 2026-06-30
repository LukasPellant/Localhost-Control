import { useEffect, useRef, type KeyboardEvent } from "react";
import { AlertTriangle } from "lucide-react";
import type { PortEntry } from "@localhost-control/shared";
import type { ProjectProfile } from "../lib/projectProfiles";
import type { ProjectWorkspace } from "../lib/projectWorkspaces";

type WorkspaceActionDialogProps = {
  workspace: ProjectWorkspace;
  profiles: Array<{ profile: ProjectProfile; entry: PortEntry }>;
  action?: "stop" | "restart" | "restart-failed";
  onCancel(): void;
  onConfirm(): void;
};

export const WorkspaceActionDialog = ({ workspace, profiles, action = "stop", onCancel, onConfirm }: WorkspaceActionDialogProps) => {
  const dialogRef = useRef<HTMLElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const title =
    action === "restart-failed"
      ? `Restart failed profiles in ${workspace.name}`
      : action === "restart"
        ? `Restart workspace ${workspace.name}`
        : `Stop workspace ${workspace.name}`;
  const description =
    action === "restart-failed"
      ? "Review the failed profile processes before stopping and starting them again."
      : action === "restart"
      ? "Review the running profile processes before stopping and starting them again."
      : "Review the running profile processes before forcing them to close.";
  const confirmLabel =
    action === "restart-failed" ? `Restart failed ${profiles.length}` : action === "restart" ? `Restart ${profiles.length}` : `Force stop ${profiles.length}`;

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
      <section
        ref={dialogRef}
        className="safe-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={keepFocusInDialog}
      >
        <div className="safe-dialog-heading">
          <AlertTriangle size={19} />
          <div>
            <h2>{title}?</h2>
            <p>{description}</p>
          </div>
        </div>
        <dl className="safe-dialog-grid">
          {profiles.map(({ profile, entry }) => (
            <div className="wide" key={`${entry.pid}:${entry.port}`}>
              <dt>{profile.name}</dt>
              <dd>
                PID {entry.pid} on port {entry.port} - {entry.processName}
              </dd>
            </div>
          ))}
        </dl>
        <div className="safe-dialog-actions">
          <button ref={cancelRef} type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="danger-command" type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
};
