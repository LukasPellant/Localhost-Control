import type { ProjectProfile } from "./projectProfiles";
import { getExtensionApi, hasPromiseExtensionApi } from "./extensionApi";

export type ProfileHealthState = "healthy" | "unhealthy" | "blocked" | "error" | "checking";

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

const healthBlockedResult = (profile: ProjectProfile): ProfileHealthResult => ({
  profileId: profile.id,
  state: "blocked",
  label: "Health check blocked",
  checkedAt: nowIso(),
  message: `${profile.name} health check is limited to localhost URLs.`
});

const healthPermissionDeniedResult = (profile: ProjectProfile): ProfileHealthResult => ({
  profileId: profile.id,
  state: "blocked",
  label: "Health permission denied",
  checkedAt: nowIso(),
  message: `${profile.name} health check needs permission for ${new URL(profile.healthUrl ?? "").origin}.`
});

const requestOriginPermission = async (healthUrl: string): Promise<boolean> => {
  const api = getExtensionApi();
  const permissions = api?.permissions;
  if (!permissions?.request && !permissions?.contains) return true;

  const origins = [hostPermissionPattern(healthUrl)];
  if (permissions.contains) {
    if (hasPromiseExtensionApi()) {
      try {
        if (await permissions.contains({ origins })) return true;
      } catch {
        return false;
      }
    } else {
      const alreadyGranted = await new Promise<boolean>((resolve) => {
        permissions.contains?.({ origins }, (granted) => resolve(!api?.runtime?.lastError && Boolean(granted)));
      });
      if (alreadyGranted) return true;
    }
  }

  if (!permissions.request) return false;

  if (hasPromiseExtensionApi()) {
    try {
      return Boolean(await permissions.request({ origins }));
    } catch {
      return false;
    }
  }

  return new Promise((resolve) => {
    permissions.request?.({ origins }, (granted) => resolve(!api?.runtime?.lastError && Boolean(granted)));
  });
};

export type ProfileHealthOptions = {
  timeoutMs?: number;
};

export const preflightProfileHealthCheck = async (profile: ProjectProfile): Promise<ProfileHealthResult | undefined> => {
  if (!profile.healthUrl || !isLocalHttpUrl(profile.healthUrl)) {
    return healthBlockedResult(profile);
  }

  if (!(await requestOriginPermission(profile.healthUrl))) {
    return healthPermissionDeniedResult(profile);
  }

  return undefined;
};

export const checkProfileHealth = async (
  profile: ProjectProfile,
  fetcher: FetchLike = fetch,
  options: ProfileHealthOptions = {}
): Promise<ProfileHealthResult> => {
  const preflightResult = await preflightProfileHealthCheck(profile);
  if (preflightResult) return preflightResult;

  const healthUrl = profile.healthUrl;
  if (!healthUrl) return healthBlockedResult(profile);

  const timeoutMs = options.timeoutMs ?? 3500;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(healthUrl, { cache: "no-store", redirect: "manual", signal: controller.signal });
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
