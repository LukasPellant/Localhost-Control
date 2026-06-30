import type { ProjectProfile } from "./projectProfiles";
import { getExtensionApi, hasPromiseExtensionApi } from "./extensionApi";

export type ProfileNotificationKind = "ready" | "failed";

export type ProfileNotificationResult = {
  notified: boolean;
  reason?: "unavailable" | "failed";
};

const iconUrl = "icons/localhost-control-ghost-48.png";

const notificationId = (kind: ProfileNotificationKind, profile: ProjectProfile): string =>
  `localhost-control-health-${profile.id}-${kind}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96);

const notificationTitle = (kind: ProfileNotificationKind, profile: ProjectProfile): string =>
  kind === "ready" ? `${profile.name} is ready` : `${profile.name} needs attention`;

export const notifyProfileHealth = async (
  kind: ProfileNotificationKind,
  profile: ProjectProfile,
  message: string
): Promise<ProfileNotificationResult> => {
  const api = getExtensionApi();
  const create = api?.notifications?.create;
  if (!create) return { notified: false, reason: "unavailable" };

  const id = notificationId(kind, profile);
  const options = {
    type: "basic" as const,
    iconUrl,
    title: notificationTitle(kind, profile),
    message
  };

  try {
    if (hasPromiseExtensionApi()) {
      await create(id, options);
    } else {
      await new Promise<void>((resolve, reject) => {
        const result = create(id, options, () => {
          const runtimeError = api?.runtime?.lastError?.message;
          if (runtimeError) {
            reject(new Error(runtimeError));
            return;
          }
          resolve();
        });
        if (result instanceof Promise) result.then(() => resolve()).catch(reject);
      });
    }
  } catch {
    return { notified: false, reason: "failed" };
  }

  const runtimeError = getExtensionApi()?.runtime?.lastError?.message;
  if (runtimeError) return { notified: false, reason: "failed" };

  return { notified: true };
};
