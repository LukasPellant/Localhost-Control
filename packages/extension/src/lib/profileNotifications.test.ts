import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyProfileHealth } from "./profileNotifications";
import type { ProjectProfile } from "./projectProfiles";

const profile: ProjectProfile = {
  id: "docs",
  name: "Docs",
  expectedPort: 4321,
  mainUrl: "http://127.0.0.1:4321"
};

afterEach(() => {
  Reflect.deleteProperty(globalThis, "chrome");
  Reflect.deleteProperty(globalThis, "browser");
});

describe("notifyProfileHealth", () => {
  it("reports unavailable notification APIs without throwing", async () => {
    await expect(notifyProfileHealth("ready", profile, "Docs is ready (204)")).resolves.toEqual({
      notified: false,
      reason: "unavailable"
    });
  });

  it("creates Firefox promise-style ready notifications", async () => {
    const create = vi.fn(async () => "localhost-control-health-docs-ready");
    (globalThis as { browser?: unknown }).browser = {
      notifications: { create }
    };

    await expect(notifyProfileHealth("ready", profile, "Docs is ready (204)")).resolves.toEqual({
      notified: true
    });
    expect(create).toHaveBeenCalledWith("localhost-control-health-docs-ready", {
      type: "basic",
      iconUrl: "icons/localhost-control-ghost-48.png",
      title: "Docs is ready",
      message: "Docs is ready (204)"
    });
  });

  it("creates Chrome callback-style failed notifications", async () => {
    const create = vi.fn((_id, _options, callback: () => void) => callback());
    (globalThis as { chrome?: unknown }).chrome = {
      notifications: { create }
    };

    await expect(notifyProfileHealth("failed", profile, "Docs did not become healthy.")).resolves.toEqual({
      notified: true
    });
    expect(create).toHaveBeenCalledWith(
      "localhost-control-health-docs-failed",
      expect.objectContaining({
        title: "Docs needs attention",
        message: "Docs did not become healthy."
      }),
      expect.any(Function)
    );
  });
});
