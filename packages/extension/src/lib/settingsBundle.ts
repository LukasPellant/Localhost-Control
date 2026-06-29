import { sanitizeSettings, type Settings } from "./settings";

export const SETTINGS_BUNDLE_SCHEMA = "localhost-control-settings";
export const SETTINGS_BUNDLE_VERSION = 1;

type SettingsBundle = {
  schema: typeof SETTINGS_BUNDLE_SCHEMA;
  version: typeof SETTINGS_BUNDLE_VERSION;
  exportedAt: string;
  settings: Settings;
};

export type SettingsImportResult =
  | {
      ok: true;
      settings: Settings;
      summary: string;
    }
  | {
      ok: false;
      error: string;
    };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const legacySettingsKeys = new Set([
  "includeSystemPorts",
  "httpProbe",
  "refreshIntervalSec",
  "themeMode",
  "hiddenPorts",
  "customPortRange",
  "trustedProjectRoots",
  "trustedProjectPaths",
  "blockedProcessNames",
  "projectProfiles",
  "projectWorkspaces"
]);

const pluralize = (count: number, singular: string, plural: string): string => `${count} ${count === 1 ? singular : plural}`;
const hasLegacySettingsShape = (value: Record<string, unknown>): boolean => Object.keys(value).some((key) => legacySettingsKeys.has(key));

const importSummary = (settings: Settings): string =>
  `Imported ${pluralize(settings.projectProfiles.length, "profile", "profiles")} and ${pluralize(
    settings.projectWorkspaces.length,
    "workspace",
    "workspaces"
  )}`;

export const exportSettingsBundle = (settings: Settings, exportedAt = new Date().toISOString()): string => {
  const bundle: SettingsBundle = {
    schema: SETTINGS_BUNDLE_SCHEMA,
    version: SETTINGS_BUNDLE_VERSION,
    exportedAt,
    settings: sanitizeSettings(settings)
  };

  return JSON.stringify(bundle, null, 2);
};

export const importSettingsBundle = (raw: string): SettingsImportResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, error: "Config import failed: invalid JSON" };
  }

  if (!isRecord(parsed)) {
    return { ok: false, error: "Config import failed: unsupported settings bundle" };
  }

  const looksWrapped = "schema" in parsed || "version" in parsed || "settings" in parsed;
  if (looksWrapped) {
    if (parsed.schema !== SETTINGS_BUNDLE_SCHEMA || parsed.version !== SETTINGS_BUNDLE_VERSION || !("settings" in parsed)) {
      return { ok: false, error: "Config import failed: unsupported settings bundle" };
    }
    const settings = sanitizeSettings(parsed.settings);
    return { ok: true, settings, summary: importSummary(settings) };
  }

  if (!hasLegacySettingsShape(parsed)) {
    return { ok: false, error: "Config import failed: unsupported settings bundle" };
  }

  const settings = sanitizeSettings(parsed);
  return { ok: true, settings, summary: importSummary(settings) };
};
