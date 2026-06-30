import { describe, expect, it, vi } from "vitest";
import { checkProfileHealth } from "./profileHealth";
import type { ProjectProfile } from "./projectProfiles";

const profile: ProjectProfile = {
  id: "shop",
  name: "Example Shop",
  healthUrl: "http://127.0.0.1:5173/health"
};

describe("profile health checks", () => {
  it("reports a healthy local profile health endpoint", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 204, statusText: "No Content" }));

    await expect(checkProfileHealth(profile, fetcher)).resolves.toMatchObject({
      profileId: "shop",
      state: "healthy",
      statusCode: 204,
      label: "Healthy 204"
    });
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:5173/health",
      expect.objectContaining({ cache: "no-store", redirect: "manual" })
    );
  });

  it("allows local development hostnames and 0.0.0.0 without fetching external origins", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, statusText: "OK" }));

    await expect(checkProfileHealth({ ...profile, healthUrl: "https://api.myapp.localhost/health" }, fetcher)).resolves.toMatchObject({
      state: "healthy",
      label: "Healthy 200"
    });
    await expect(checkProfileHealth({ ...profile, healthUrl: "http://0.0.0.0:5173/health" }, fetcher)).resolves.toMatchObject({
      state: "healthy",
      label: "Healthy 200"
    });
  });

  it("reports an unhealthy response without throwing", async () => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 503, statusText: "Service Unavailable" }));

    await expect(checkProfileHealth(profile, fetcher)).resolves.toMatchObject({
      profileId: "shop",
      state: "unhealthy",
      statusCode: 503,
      label: "Unhealthy 503"
    });
  });

  it("rejects non-local health URLs before fetching", async () => {
    const fetcher = vi.fn();

    await expect(checkProfileHealth({ ...profile, healthUrl: "https://example.com/health" }, fetcher)).resolves.toMatchObject({
      profileId: "shop",
      state: "blocked",
      label: "Health check blocked"
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("treats callback-style browser permission errors as denied health permission", async () => {
    const fetcher = vi.fn();
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: { lastError: { message: "Permission prompt failed" } },
      permissions: {
        request: vi.fn((_permissions, callback: (granted: boolean) => void) => callback(true))
      }
    };

    await expect(checkProfileHealth(profile, fetcher)).resolves.toMatchObject({
      profileId: "shop",
      state: "blocked",
      label: "Health permission denied"
    });
    expect(fetcher).not.toHaveBeenCalled();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it("uses existing optional origin permission without requesting again", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, statusText: "OK" }));
    const request = vi.fn(async () => false);
    (globalThis as { browser?: unknown }).browser = {
      permissions: {
        contains: vi.fn(async () => true),
        request
      }
    };

    await expect(checkProfileHealth(profile, fetcher)).resolves.toMatchObject({
      state: "healthy",
      label: "Healthy 200"
    });
    expect(request).not.toHaveBeenCalled();
    delete (globalThis as { browser?: unknown }).browser;
  });

  it("times out slow health checks", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(
      (_input: string, init: { signal?: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        })
    );
    const resultPromise = checkProfileHealth(profile, fetcher, { timeoutMs: 250 });

    await vi.advanceTimersByTimeAsync(250);

    await expect(resultPromise).resolves.toMatchObject({
      profileId: "shop",
      state: "error",
      label: "Health check timed out"
    });
    vi.useRealTimers();
  });
});
