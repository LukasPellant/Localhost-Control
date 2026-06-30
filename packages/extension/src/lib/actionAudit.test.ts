import { describe, expect, it } from "vitest";
import { appendActionAuditEntry, createActionAuditEntry, sanitizeActionAudit, type ActionAuditEntry } from "./actionAudit";

describe("action audit", () => {
  it("creates safe local audit entries without command-line details", () => {
    expect(
      createActionAuditEntry(
        {
          action: "start-profile",
          target: "Example Shop",
          detail: "Waiting for health check"
        },
        new Date("2026-06-30T08:00:00.000Z")
      )
    ).toEqual({
      id: "2026-06-30t08-00-00-000z-start-profile-example-shop",
      action: "start-profile",
      target: "Example Shop",
      detail: "Waiting for health check",
      createdAt: "2026-06-30T08:00:00.000Z"
    });
  });

  it("sanitizes imported audit entries and caps history to the newest items", () => {
    const entries = Array.from({ length: 22 }, (_, index): ActionAuditEntry => ({
      id: `entry-${index}`,
      action: "browser-cleanup",
      target: `http://127.0.0.1:${3000 + index}`,
      createdAt: `2026-06-30T08:${String(index).padStart(2, "0")}:00.000Z`
    }));

    expect(sanitizeActionAudit([...entries, { id: "bad", action: "run-anything", target: "Nope" }])).toHaveLength(20);
    expect(sanitizeActionAudit(entries)[0]?.id).toBe("entry-2");
    expect(sanitizeActionAudit(entries).at(-1)?.id).toBe("entry-21");
  });

  it("appends audit entries without growing beyond the local retention cap", () => {
    const actionAudit = Array.from({ length: 20 }, (_, index): ActionAuditEntry => ({
      id: `entry-${index}`,
      action: "stop-process",
      target: `node ${index}`,
      createdAt: "2026-06-30T08:00:00.000Z"
    }));

    expect(
      appendActionAuditEntry(
        { actionAudit, untouched: true },
        {
          id: "new-entry",
          action: "start-workspace",
          target: "Daily stack",
          createdAt: "2026-06-30T09:00:00.000Z"
        }
      )
    ).toMatchObject({
      untouched: true,
      actionAudit: expect.arrayContaining([expect.objectContaining({ id: "new-entry" })])
    });
  });
});
