export type ActionAuditKind =
  | "start-profile"
  | "start-workspace"
  | "stop-process"
  | "browser-cleanup"
  | "open-private-window"
  | "open-mobile-preview"
  | "open-project-folder";

export type ActionAuditEntry = {
  id: string;
  action: ActionAuditKind;
  target: string;
  detail?: string;
  createdAt: string;
};

export type ActionAuditInput = {
  action: ActionAuditKind;
  target: string;
  detail?: string;
};

const maxAuditEntries = 20;
const allowedActions = new Set<ActionAuditKind>([
  "start-profile",
  "start-workspace",
  "stop-process",
  "browser-cleanup",
  "open-private-window",
  "open-mobile-preview",
  "open-project-folder"
]);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const trimText = (value: string, maxLength: number): string => value.trim().slice(0, maxLength);

export const sanitizeActionAudit = (value: unknown): ActionAuditEntry[] => {
  if (!Array.isArray(value)) return [];

  return value
    .flatMap((item): ActionAuditEntry[] => {
      if (!isRecord(item) || !isNonEmptyString(item.id) || !isNonEmptyString(item.action) || !isNonEmptyString(item.target)) return [];
      if (!allowedActions.has(item.action as ActionAuditKind)) return [];
      const createdAt = isNonEmptyString(item.createdAt) ? item.createdAt : new Date(0).toISOString();
      const entry: ActionAuditEntry = {
        id: trimText(item.id, 96),
        action: item.action as ActionAuditKind,
        target: trimText(item.target, 120),
        createdAt: trimText(createdAt, 48)
      };
      if (isNonEmptyString(item.detail)) entry.detail = trimText(item.detail, 180);
      return [entry];
    })
    .slice(-maxAuditEntries);
};

export const createActionAuditEntry = (input: ActionAuditInput, now = new Date()): ActionAuditEntry => {
  const createdAt = now.toISOString();
  return {
    id: `${createdAt}-${input.action}-${input.target}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96),
    action: input.action,
    target: trimText(input.target, 120),
    ...(input.detail ? { detail: trimText(input.detail, 180) } : {}),
    createdAt
  };
};

export const appendActionAuditEntry = <T extends { actionAudit: ActionAuditEntry[] }>(settings: T, entry: ActionAuditEntry): T => ({
  ...settings,
  actionAudit: sanitizeActionAudit([...settings.actionAudit, entry])
});
