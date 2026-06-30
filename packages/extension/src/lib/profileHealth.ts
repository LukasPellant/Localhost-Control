import type { ProjectProfile } from "./projectProfiles";
import { getExtensionApi, hasPromiseExtensionApi } from "./extensionApi";

export type ProfileHealthState = "healthy" | "unhealthy" | "blocked" | "error";

export type ProfileHealthResult = {
  profileId: string;
  state: ProfileHealthState;
  label: string;
  statusCode?: number;
  checkedAt: string;
  message: string;
};

type FetchLike = (
  input: string,
  init: { cache: "no-store"; redirect: "manual"; signal?: AbortSignal }
) => Promise<Pick<Response, "ok" | "status" | "statusText">>;

const localHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

const isLocalHostname = (hostname: string): boolean => {
  const value = hostname.toLowerCase();
  return localHosts.has(value) || value.endsWith(".localhost");
};

const isLocalHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && isLocalHostname(url.hostname);
  } catch {
    return false;
  }
};

const nowIso = (): string => new Date().toISOString();

const hostPermissionPattern = (value: string): string => {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  const host = hostname.endsWith(".localhost") ? "*.localhost" : hostname === "::1" || hostname === "[::1]" ? "[::1]" : hostname;
  return `${url.protocol}//${host}/*`;
};

const requestOriginPermission = async (healthUrl: string): Promise<boolean> => {
  const permissions = getExtensionApi()?.permissions;
  if (!permissions?.request) return true;

  const origins = [hostPermissionPattern(healthUrl)];
  if (hasPromiseExtensionApi()) {
    return Boolean(await permissions.request({ origins }));
  }

  return new Promise((resolve) => {
    permissions.request?.({ origins }, (granted) => resolve(granted));
  });
};

export type ProfileHealthOptions = {
  timeoutMs?: number;
};

export const checkProfileHealth = async (
  profile: ProjectProfile,
  fetcher: FetchLike = fetch,
  options: ProfileHealthOptions = {}
): Promise<ProfileHealthResult> => {
  if (!profile.healthUrl || !isLocalHttpUrl(profile.healthUrl)) {
    return {
      profileId: profile.id,
      state: "blocked",
      label: "Health check blocked",
      checkedAt: nowIso(),
      message: `${profile.name} health check is limited to localhost URLs.`
    };
  }

  if (!(await requestOriginPermission(profile.healthUrl))) {
    return {
      profileId: profile.id,
      state: "blocked",
      label: "Health permission denied",
      checkedAt: nowIso(),
      message: `${profile.name} health check needs permission for ${new URL(profile.healthUrl).origin}.`
    };
  }

  const timeoutMs = options.timeoutMs ?? 3500;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(profile.healthUrl, { cache: "no-store", redirect: "manual", signal: controller.signal });
    const state = response.ok ? "healthy" : "unhealthy";
    return {
      profileId: profile.id,
      state,
      label: `${response.ok ? "Healthy" : "Unhealthy"} ${response.status}`,
      statusCode: response.status,
      checkedAt: nowIso(),
      message: response.ok
        ? `${profile.name} health check passed (${response.status})`
        : `${profile.name} health check failed (${response.status})`
    };
  } catch (error) {
    const timedOut = controller.signal.aborted;
    return {
      profileId: profile.id,
      state: "error",
      label: timedOut ? "Health check timed out" : "Health check failed",
      checkedAt: nowIso(),
      message: timedOut ? `${profile.name} health check timed out.` : error instanceof Error ? error.message : String(error)
    };
  } finally {
    window.clearTimeout(timeout);
  }
};
