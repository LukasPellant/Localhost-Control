import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppWindow,
  BookOpen,
  Code2,
  Copy,
  Download,
  FolderPlus,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  SlidersHorizontal,
  Square,
  Star,
  Terminal,
  Upload
} from "lucide-react";
import { withAppScope, type KillParams, type KillResult, type PortEntry, type ScanResult, type StopMode } from "@localhost-control/shared";
import { DetailPanel } from "./components/DetailPanel";
import { IconButton } from "./components/IconButton";
import { PortList } from "./components/PortList";
import { SafeActionDialog } from "./components/SafeActionDialog";
import { SettingsManager } from "./components/SettingsManager";
import { WorkspaceActionDialog } from "./components/WorkspaceActionDialog";
import {
  clearBrowserDataForUrl,
  openMobilePreviewForUrl,
  openPrivateWindowForUrl,
  reloadLocalhostTabsForUrl,
  type BrowserCleanupMode,
  type BrowserPreviewPreset
} from "./lib/browserCleanup";
import { appendActionAuditEntry, createActionAuditEntry, type ActionAuditInput } from "./lib/actionAudit";
import { formatDevContext, formatProfileContext, formatScanContext, formatWorkspaceContext } from "./lib/devContext";
import { getExtensionApi } from "./lib/extensionApi";
import { type HostClient } from "./lib/hostClient";
import { analyzePortDoctor, formatPortDoctorAdvice, type PortDoctorReport } from "./lib/portDoctor";
import { filterEntries, filterLabel, type FilterId } from "./lib/portFilters";
import { checkProfileHealth, preflightProfileHealthCheck, type ProfileHealthResult } from "./lib/profileHealth";
import { notifyProfileHealth } from "./lib/profileNotifications";
import { deriveProfileStates, matchProfileForEntry, scoreProfileForEntry, type ProfileState, type ProjectProfile } from "./lib/projectProfiles";
import { formatProfileLogs } from "./lib/profileLogs";
import { deriveWorkspaceStates, type ProjectWorkspace, type WorkspaceState } from "./lib/projectWorkspaces";
import { slugifyLocalId } from "./lib/localIds";
import { defaultSettings, loadSettings, saveActionAudit, saveSettings, type Settings } from "./lib/settings";
import { canonicalizeProfileStartCommand, preferredProfilePort, retargetProfilePort } from "./lib/startPorts";
import {
  removeProjectProfile,
  removeProjectWorkspace,
  removeTrustedProjectRoot,
  removeTrustedProjectPath,
  clearActionAudit,
  unblockProcessName,
  unhidePort,
  upsertProjectProfile
} from "./lib/settingsActions";
import { exportSettingsBundle, importSettingsBundle } from "./lib/settingsBundle";
import { detectStaleProcess, formatStaleProcessAdvice, type StaleProcessSignal } from "./lib/staleProcesses";
import "./styles.css";

const filters: FilterId[] = ["web", "all", "custom"];
const themeQuery = "(prefers-color-scheme: dark)";
const nativeHostReleasesUrl = "https://github.com/LukasPellant/Localhost-Control/releases";

type AppProps = {
  client: HostClient;
};

type StartableProjectProfile = ProjectProfile & {
  projectPath: string;
  startCommand: string;
};

type RestartableProfileEntry = {
  profile: StartableProjectProfile;
  entry: PortEntry;
};

type WorkspaceRestartMode = "all" | "failed";
type ActiveView = "dev" | "favorites";

type PendingWorkspaceRestart = {
  state: WorkspaceState;
  mode: WorkspaceRestartMode;
};

type PreparedProfileStartResult =
  | {
      ok: true;
      profile: StartableProjectProfile;
      portChanged: boolean;
      selectedPort?: number;
    }
  | { ok: false; message: string };

const imageIconPattern = /^(https?:\/\/|data:image\/|\/)/i;
const killClosedPort = (result: KillResult): boolean => result.killed && result.portClosed;
const fallbackDetailForStart = (profile: ProjectProfile, result: { portChanged: boolean; selectedPort?: number }): string | undefined =>
  result.portChanged && result.selectedPort ? `Preferred ${preferredProfilePort(profile)} busy; started on ${result.selectedPort}` : undefined;
const appendFallbackDetails = (summary: string, details: string[]): string => (details.length ? `${summary}; ${details.join("; ")}` : summary);

const nativeHostDownloadUrl = (): string => {
  const version = getExtensionApi()?.runtime?.getManifest?.().version;
  return version ? `${nativeHostReleasesUrl}/tag/v${version}` : nativeHostReleasesUrl;
};
const resolveTheme = (themeMode: Settings["themeMode"]): "light" | "dark" => {
  if (themeMode === "dark") return "dark";
  if (themeMode === "light") return "light";
  return typeof window !== "undefined" && window.matchMedia?.(themeQuery).matches ? "dark" : "light";
};
const copyText = async (text: string): Promise<void> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall through to the selection-based copy path for extension pages where Clipboard API is blocked.
  }

  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand?.("copy") ?? false;
  field.remove();
  if (!copied) throw new Error("Clipboard copy is unavailable.");
};
const readFileText = async (file: File): Promise<string> => {
  if (typeof file.text === "function") {
    return file.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Unable to read file.")));
    reader.readAsText(file);
  });
};

const settingsExportSummary = (settings: Settings): string =>
  `Exported settings with ${settings.projectProfiles.length} ${settings.projectProfiles.length === 1 ? "profile" : "profiles"} and ${
    settings.projectWorkspaces.length
  } ${settings.projectWorkspaces.length === 1 ? "workspace" : "workspaces"}`;
const profileReadyPollAttempts = 6;
const profileReadyPollDelayMs = 500;
const profileObservePollAttempts = 6;
const profileObservePollDelayMs = 500;
const isStartableProjectProfile = (profile: ProjectProfile): profile is StartableProjectProfile =>
  Boolean(profile.projectPath && profile.startCommand);
const normalizeProjectPath = (value: string): string =>
  value
    .trim()
    .replace(/\//g, "\\")
    .replace(/\\+$/, "")
    .toLowerCase();
const isTrustedProjectPath = (settings: Settings, projectPath: string): boolean => {
  const normalizedPath = normalizeProjectPath(projectPath);
  return (
    settings.trustedProjectPaths.some((path) => normalizeProjectPath(path) === normalizedPath) ||
    settings.trustedProjectRoots.some((root) => {
      const normalizedRoot = normalizeProjectPath(root);
      return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}\\`);
    })
  );
};
const isTrustedStartableProjectProfile = (settings: Settings, profile: ProjectProfile): profile is StartableProjectProfile =>
  isStartableProjectProfile(profile) && isTrustedProjectPath(settings, profile.projectPath);
const delay = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));
const hasSameProfileIds = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((profileId) => right.includes(profileId));
const checkingProfileHealthResult = (profile: ProjectProfile): ProfileHealthResult => ({
  profileId: profile.id,
  state: "checking",
  label: "Waiting for health",
  checkedAt: new Date().toISOString(),
  message: `Waiting for ${profile.name} health check...`
});
const profileInitials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
const ProfileLogo = ({ profile }: { profile: ProjectProfile }) => {
  if (profile.icon && imageIconPattern.test(profile.icon)) {
    return (
      <span className="profile-logo" aria-label={`${profile.name} logo`}>
        <img src={profile.icon} alt="" />
      </span>
    );
  }

  const icon = profile.icon?.toLowerCase();
  const symbol =
    icon === "book" || icon === "docs" ? (
      <BookOpen size={15} />
    ) : icon === "code" || icon === "terminal" ? (
      <Code2 size={15} />
    ) : icon === "app" || icon === "window" ? (
      <AppWindow size={15} />
    ) : (
      profileInitials(profile.name)
    );

  return (
    <span className="profile-logo" aria-label={`${profile.name} logo`}>
      {symbol}
    </span>
  );
};

export const App = ({ client }: AppProps) => {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterId>("web");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [hostError, setHostError] = useState<string | null>(null);
  const [pendingKillEntry, setPendingKillEntry] = useState<PortEntry | null>(null);
  const [pendingWorkspaceStop, setPendingWorkspaceStop] = useState<WorkspaceState | null>(null);
  const [pendingProfileRestart, setPendingProfileRestart] = useState<RestartableProfileEntry | null>(null);
  const [pendingWorkspaceRestart, setPendingWorkspaceRestart] = useState<PendingWorkspaceRestart | null>(null);
  const [profileHealthResults, setProfileHealthResults] = useState<Record<string, ProfileHealthResult>>({});
  const [settingsManagerOpen, setSettingsManagerOpen] = useState(false);
  const [settingsActionSaving, setSettingsActionSaving] = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>("dev");
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const settingsActionSavingRef = useRef(false);
  const viewSelectedRef = useRef(false);
  const settingsRef = useRef(settings);
  const auditSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const profileHealthRequestSeqRef = useRef<Record<string, number>>({});
  const importFileRef = useRef<HTMLInputElement | null>(null);

  const openExternalUrl = useCallback((url: string, mode: "tab" | "window" = "tab") => {
    const api = getExtensionApi();
    if (mode === "window" && api?.windows?.create) {
      void Promise.resolve(api.windows.create({ url, type: "popup" })).catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : String(error));
      });
      return;
    }

    const tabs = api?.tabs;
    if (tabs?.create) {
      void Promise.resolve(tabs.create({ url })).catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : String(error));
      });
      return;
    }
    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const openNativeHostDownload = useCallback(() => {
    openExternalUrl(nativeHostDownloadUrl());
  }, [openExternalUrl]);

  useEffect(() => {
    void loadSettings().then(setSettings);
  }, []);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    if (viewSelectedRef.current) return;
    if (settings.projectProfiles.length || settings.projectWorkspaces.length) {
      setActiveView("favorites");
    }
  }, [settings.projectProfiles.length, settings.projectWorkspaces.length]);

  useEffect(() => {
    const applyTheme = () => {
      const theme = resolveTheme(settings.themeMode);
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.themeMode = settings.themeMode;
      document.documentElement.style.colorScheme = theme;
    };

    applyTheme();

    if (settings.themeMode !== "system" || typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia(themeQuery);
    media.addEventListener?.("change", applyTheme);
    return () => media.removeEventListener?.("change", applyTheme);
  }, [settings.themeMode]);

  const scan = useCallback(async () => {
    setBusy(true);
    setHostError(null);
    try {
      const result = await client.scan({
        includeSystemPorts: settings.includeSystemPorts,
        httpProbe: settings.httpProbe,
        maxProbeMs: 550
      });
      setScanResult(result);
      setSelectedKey((current) => current ?? (result.entries[0] ? `${result.entries[0].pid}:${result.entries[0].port}` : null));
      setMessage(`Scanned ${result.entries.length} ports in ${result.durationMs} ms`);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setHostError(text);
      setMessage(text);
    } finally {
      setBusy(false);
    }
  }, [client, settings.httpProbe, settings.includeSystemPorts]);

  const scanForProfileObservation = async (): Promise<ScanResult> => {
    const result = await client.scan({
      includeSystemPorts: settingsRef.current.includeSystemPorts,
      httpProbe: settingsRef.current.httpProbe,
      maxProbeMs: 550
    });
    setScanResult(result);
    setSelectedKey((current) => current ?? (result.entries[0] ? `${result.entries[0].pid}:${result.entries[0].port}` : null));
    setHostError(null);
    return result;
  };

  const scanResultProfileEntry = (profile: ProjectProfile, result: ScanResult): PortEntry | undefined =>
    deriveProfileStates(
      [profile],
      result.entries.filter((entry) => !settingsRef.current.hiddenPorts.includes(entry.port)).map((entry) => withAppScope(entry, settingsRef.current))
    )[0]?.entry;

  useEffect(() => {
    void scan();
  }, [scan]);

  useEffect(() => {
    if (!settingsManagerOpen) return;
    window.setTimeout(() => document.getElementById("settings-manager")?.focus(), 0);
  }, [settingsManagerOpen]);

  useEffect(() => {
    if (!settings.refreshIntervalSec) return;
    const handle = window.setInterval(() => void scan(), settings.refreshIntervalSec * 1000);
    return () => window.clearInterval(handle);
  }, [scan, settings.refreshIntervalSec]);

  const entries = useMemo(
    () =>
      (scanResult?.entries ?? [])
        .filter((entry) => !settings.hiddenPorts.includes(entry.port))
        .map((entry) => withAppScope(entry, settings)),
    [scanResult?.entries, settings]
  );
  const visibleEntries = useMemo(
    () => filterEntries(entries, { query, filter, customPortRange: settings.customPortRange, scopePolicy: settings }),
    [entries, query, filter, settings]
  );
  const selectedListEntry = useMemo(
    () => visibleEntries.find((entry) => `${entry.pid}:${entry.port}` === selectedKey) ?? visibleEntries[0],
    [selectedKey, visibleEntries]
  );
  const profileStates = useMemo(
    () =>
      deriveProfileStates(settings.projectProfiles, entries).map((state) => {
        const healthResult = profileHealthResults[state.profile.id];
        if (!healthResult) return state;
        const status: ProfileState["status"] =
          healthResult.state === "healthy"
            ? "running"
            : healthResult.state === "unhealthy"
              ? "unhealthy"
              : healthResult.state === "error"
                ? "unhealthy"
              : healthResult.state === "checking"
                ? "starting"
                : state.status;
        return {
          ...state,
          status,
          healthLabel: healthResult.label
        };
      }),
    [entries, profileHealthResults, settings.projectProfiles]
  );
  const profileForEntry = useCallback(
    (entry: PortEntry): ProjectProfile | undefined => matchProfileForEntry(entry, settings.projectProfiles)?.profile,
    [settings.projectProfiles]
  );
  const selectedProfileState = useMemo(
    () => profileStates.find((state) => state.profile.id === selectedProfileId) ?? (activeView === "favorites" ? profileStates[0] : undefined),
    [activeView, profileStates, selectedProfileId]
  );
  const detailEntry = activeView === "favorites" && selectedProfileState ? selectedProfileState.entry : selectedListEntry;
  const detailProfile = activeView === "favorites" && selectedProfileState ? selectedProfileState.profile : detailEntry ? profileForEntry(detailEntry) : undefined;
  const projectFolderPathForEntry = useCallback(
    (entry: PortEntry): string | undefined => {
      const profile = profileForEntry(entry);
      const projectPath = profile?.projectPath ?? entry.projectHint;
      return projectPath && isTrustedProjectPath(settings, projectPath) ? projectPath : undefined;
    },
    [profileForEntry, settings]
  );
  const projectFolderPathForProfile = useCallback(
    (profile: ProjectProfile): string | undefined => (profile.projectPath && isTrustedProjectPath(settings, profile.projectPath) ? profile.projectPath : undefined),
    [settings]
  );
  const detailProjectFolderPath = detailEntry ? projectFolderPathForEntry(detailEntry) : detailProfile ? projectFolderPathForProfile(detailProfile) : undefined;
  const detailProfileHealth = detailProfile ? profileHealthResults[detailProfile.id] : undefined;
  const workspaceStates = useMemo(
    () => deriveWorkspaceStates(settings.projectWorkspaces, settings.projectProfiles, profileStates),
    [profileStates, settings.projectProfiles, settings.projectWorkspaces]
  );
  const hasWorkspaceForCurrentProfiles = useMemo(() => {
    const profileIds = settings.projectProfiles.map((profile) => profile.id);
    if (profileIds.length < 2) return false;
    return settings.projectWorkspaces.some((workspace) => hasSameProfileIds(workspace.profileIds, profileIds));
  }, [settings.projectProfiles, settings.projectWorkspaces]);
  const selectedDoctorReport = useMemo(
    () => (detailEntry ? analyzePortDoctor(detailEntry, entries, settings.projectProfiles, detailProfile?.id) : undefined),
    [detailEntry, detailProfile?.id, entries, settings.projectProfiles]
  );
  const staleSignalForEntry = useCallback(
    (entry: PortEntry) => detectStaleProcess(entry, profileForEntry(entry)),
    [profileForEntry]
  );
  const selectedStaleSignal = detailEntry ? staleSignalForEntry(detailEntry) : undefined;
  const killableCount = entries.filter((entry) => entry.killable).length;
  const protectedCount = entries.length - killableCount;
  const savedItemCount = settings.projectProfiles.length + settings.projectWorkspaces.length;

  const showView = (view: ActiveView) => {
    viewSelectedRef.current = true;
    setActiveView(view);
  };

  const patchSettings = async (patch: Partial<Settings>): Promise<boolean> => {
    const previous = settings;
    const next = { ...settings, ...patch };
    settingsRef.current = next;
    setSettings(next);
    try {
      await saveSettings(next);
      return true;
    } catch (error) {
      settingsRef.current = previous;
      setSettings(previous);
      setMessage(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const replaceSettings = async (next: Settings): Promise<boolean> => {
    const previous = settings;
    const nextWithAudit = { ...next, actionAudit: previous.actionAudit };
    settingsRef.current = nextWithAudit;
    setSettings(nextWithAudit);
    try {
      await saveSettings(nextWithAudit);
      return true;
    } catch (error) {
      settingsRef.current = previous;
      setSettings(previous);
      setMessage(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const applySettingsAction = async (next: Settings, successMessage: string): Promise<boolean> => {
    if (settingsActionSavingRef.current) return false;
    settingsActionSavingRef.current = true;
    setSettingsActionSaving(true);
    try {
      if (!(await replaceSettings(next))) return false;
      setMessage(successMessage);
      window.setTimeout(() => document.getElementById("settings-manager")?.focus(), 0);
      return true;
    } finally {
      settingsActionSavingRef.current = false;
      setSettingsActionSaving(false);
    }
  };

  const recordAction = (input: ActionAuditInput) => {
    const next = appendActionAuditEntry(settingsRef.current, createActionAuditEntry(input));
    settingsRef.current = next;
    setSettings(next);
    auditSaveQueueRef.current = auditSaveQueueRef.current
      .catch(() => undefined)
      .then(() => saveActionAudit(settingsRef.current.actionAudit));
    void auditSaveQueueRef.current.catch(() => undefined);
  };

  const clearAuditHistory = async () => {
    const previous = settingsRef.current;
    const next = clearActionAudit(previous);
    settingsRef.current = next;
    setSettings(next);
    try {
      await saveActionAudit([]);
      setMessage("Cleared action audit");
      window.setTimeout(() => document.getElementById("settings-manager")?.focus(), 0);
    } catch (error) {
      settingsRef.current = previous;
      setSettings(previous);
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const requestKillEntry = (entry: PortEntry) => {
    if (!entry.killable) return;
    setPendingKillEntry(entry);
  };

  const confirmKillEntry = async (entry: PortEntry, mode: StopMode = "terminate-tree") => {
    if (!entry.killable) return;

    setBusy(true);
    setPendingKillEntry(null);
    const params: KillParams = { pid: entry.pid, port: entry.port, mode };
    const previousResult = scanResult;
    setScanResult((current) =>
      current
        ? {
            ...current,
            entries: current.entries.filter((item) => !(item.pid === entry.pid && item.port === entry.port))
          }
        : current
    );
    setSelectedKey((current) => (current === `${entry.pid}:${entry.port}` ? null : current));
    setMessage(`Stopping PID ${entry.pid} on port ${entry.port}...`);

    try {
      const result = await client.kill(params);
      await scan();
      if (killClosedPort(result)) {
        await recordAction({
          action: "stop-process",
          target: `${entry.processName} on port ${entry.port}`,
          detail: `PID ${entry.pid}`
        });
      }
      setMessage(result.message);
    } catch (error) {
      setScanResult(previousResult);
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const stopWorkspaceEntries = (state: WorkspaceState): Array<{ profile: ProjectProfile; entry: PortEntry }> =>
    state.profileStates.flatMap(({ profile, entry }) => (entry?.killable ? [{ profile, entry }] : []));

  const failedWorkspaceEntries = (state: WorkspaceState): RestartableProfileEntry[] =>
    state.profileStates.flatMap((profileState) => {
      const { profile, entry } = profileState;
      return profileState.status === "unhealthy" && entry?.killable && isTrustedStartableProjectProfile(settings, profile) ? [{ profile, entry }] : [];
    });

  const restartWorkspaceEntries = (state: WorkspaceState, mode: WorkspaceRestartMode = "all"): RestartableProfileEntry[] =>
    mode === "failed"
      ? failedWorkspaceEntries(state)
      : state.profileStates.flatMap(({ profile, entry }) =>
          entry?.killable && isTrustedStartableProjectProfile(settings, profile) ? [{ profile, entry }] : []
        );

  const requestStopWorkspace = (state: WorkspaceState) => {
    const stoppableEntries = stopWorkspaceEntries(state);
    if (!stoppableEntries.length) {
      setMessage(`No running killable profiles found for ${state.workspace.name}`);
      return;
    }
    setPendingWorkspaceStop(state);
  };

  const confirmStopWorkspace = async (state: WorkspaceState) => {
    const stoppableEntries = stopWorkspaceEntries(state);
    if (!stoppableEntries.length) {
      setPendingWorkspaceStop(null);
      setMessage(`No running killable profiles found for ${state.workspace.name}`);
      return;
    }

    setBusy(true);
    setPendingWorkspaceStop(null);
    setMessage(`Stopping workspace ${state.workspace.name}...`);
    const failures: string[] = [];
    let stoppedCount = 0;
    try {
      for (const { profile, entry } of stoppableEntries) {
        try {
          await client.kill({ pid: entry.pid, port: entry.port, mode: "force-tree" });
          stoppedCount += 1;
        } catch (error) {
          failures.push(`${profile.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      await scan();
      await recordAction({
        action: "stop-process",
        target: `Workspace ${state.workspace.name}`,
        detail: failures.length
          ? `${stoppedCount} of ${stoppableEntries.length} ${stoppableEntries.length === 1 ? "profile" : "profiles"}; ${failures.length} failed`
          : `${stoppedCount} ${stoppedCount === 1 ? "profile" : "profiles"}`
      });
      if (failures.length) {
        setMessage(`Stopped workspace ${state.workspace.name}: ${stoppedCount} of ${stoppableEntries.length} profiles; ${failures.length} failed`);
        return;
      }
      setMessage(`Stopped workspace ${state.workspace.name}: ${stoppedCount} ${stoppedCount === 1 ? "profile" : "profiles"}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const requestRestartProfile = (profile: ProjectProfile, entry: PortEntry) => {
    if (!entry.killable) return;
    if (!isTrustedStartableProjectProfile(settings, profile)) {
      setMessage(`Profile ${profile.name} is missing a trusted path or command`);
      return;
    }
    setPendingProfileRestart({ profile, entry });
  };

  const confirmRestartProfile = async ({ profile, entry }: RestartableProfileEntry, mode: StopMode = "terminate-tree") => {
    if (!entry.killable) return;

    setBusy(true);
    setPendingProfileRestart(null);
    setMessage(`Restarting profile ${profile.name}...`);
    try {
      if (profile.healthUrl && !(await preflightHealthForProfileStart(profile))) return;

      const killResult = await client.kill({ pid: entry.pid, port: entry.port, mode });
      if (!killClosedPort(killResult)) {
        setMessage(killResult.message);
        return;
      }
      await scan();
      const startResult = await startPreparedProfile(profile, { skipRunningGuard: true, skipHealthPreflight: true });
      if (!startResult.ok) return;

      const fallbackDetail = fallbackDetailForStart(profile, startResult);
      await recordAction({ action: "start-profile", target: profile.name, detail: fallbackDetail ?? "Restarted after stop" });
      if (startResult.profile.healthUrl) {
        void waitForProfileReady(startResult.profile);
        if (startResult.portChanged && startResult.selectedPort) {
          setMessage(`Restarted profile ${profile.name} on clean port ${startResult.selectedPort}; saved profile URLs updated.`);
        }
        return;
      }
      setMessage(
        startResult.portChanged && startResult.selectedPort
          ? `Restarted profile ${profile.name} on clean port ${startResult.selectedPort}; saved profile URLs updated.`
          : `Restarted profile ${profile.name}`
      );
      void waitForProfileObserved(startResult.profile);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const requestRestartWorkspace = (state: WorkspaceState, mode: WorkspaceRestartMode = "all") => {
    const restartableEntries = restartWorkspaceEntries(state, mode);
    if (!restartableEntries.length) {
      const target = mode === "failed" ? "failed profiles" : "running profiles";
      setMessage(`No ${target} with safe restart commands configured for ${state.workspace.name}`);
      return;
    }
    setPendingWorkspaceRestart({ state, mode });
  };

  const confirmRestartWorkspace = async (state: WorkspaceState, mode: WorkspaceRestartMode = "all") => {
    const restartableEntries = restartWorkspaceEntries(state, mode);
    const restartTarget = mode === "failed" ? "failed profiles" : "workspace";
    const restartPastTense = mode === "failed" ? "Restarted failed" : "Restarted";
    if (!restartableEntries.length) {
      setPendingWorkspaceRestart(null);
      const target = mode === "failed" ? "failed profiles" : "running profiles";
      setMessage(`No ${target} with safe restart commands configured for ${state.workspace.name}`);
      return;
    }

    setBusy(true);
    setPendingWorkspaceRestart(null);
    setMessage(mode === "failed" ? `Restarting failed profiles in ${state.workspace.name}...` : `Restarting workspace ${state.workspace.name}...`);
    const stoppedProfiles: StartableProjectProfile[] = [];
    const startedProfiles: StartableProjectProfile[] = [];
    const failures: string[] = [];
    try {
      for (const { profile } of restartableEntries) {
        if (profile.healthUrl && !(await preflightHealthForProfileStart(profile))) return;
      }

      for (const { profile, entry } of restartableEntries) {
        try {
          const killResult = await client.kill({ pid: entry.pid, port: entry.port, mode: "terminate-tree" });
          if (killClosedPort(killResult)) {
            stoppedProfiles.push(profile);
          } else {
            failures.push(`${profile.name}: ${killResult.message}`);
          }
        } catch (error) {
          failures.push(`${profile.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      await scan();
      let startedCount = 0;
      const avoidPorts: number[] = [];
      const fallbackDetails: string[] = [];
      for (const profile of stoppedProfiles) {
        try {
          const startResult = await startPreparedProfile(profile, {
            skipRunningGuard: true,
            skipHealthPreflight: true,
            avoidPorts
          });
          if (startResult.ok) {
            startedCount += 1;
            startedProfiles.push(startResult.profile);
            const fallbackDetail = fallbackDetailForStart(profile, startResult);
            if (fallbackDetail) fallbackDetails.push(fallbackDetail);
            if (startResult.selectedPort) avoidPorts.push(startResult.selectedPort);
          } else {
            failures.push(`${profile.name}: ${startResult.message}`);
          }
        } catch (error) {
          failures.push(`${profile.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      await recordAction({
        action: "start-workspace",
        target: state.workspace.name,
        detail: appendFallbackDetails(
          failures.length
            ? `${restartPastTense} ${startedCount} of ${restartableEntries.length} ${restartableEntries.length === 1 ? "profile" : "profiles"}; ${failures.length} failed`
            : `${restartPastTense} ${startedCount} ${startedCount === 1 ? "profile" : "profiles"}`,
          fallbackDetails
        )
      });
      const healthProfiles = startedProfiles.filter((profile) => profile.healthUrl);
      healthProfiles.forEach((profile) => void waitForProfileReady(profile));
      startedProfiles.filter((profile) => !profile.healthUrl).forEach((profile) => void waitForProfileObserved(profile));
      if (failures.length) {
        setMessage(
          `Restarted ${restartTarget} ${mode === "failed" ? `in ${state.workspace.name}` : state.workspace.name}: ${startedCount} of ${restartableEntries.length} profiles; ${failures.length} failed`
        );
        return;
      }
      setMessage(
        `Restarted ${restartTarget} ${mode === "failed" ? `in ${state.workspace.name}` : state.workspace.name}: ${startedCount} ${startedCount === 1 ? "profile" : "profiles"}`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const openEntry = (entry: PortEntry) => {
    const url = entry.url ?? `http://127.0.0.1:${entry.port}`;
    openExternalUrl(url);
  };

  const copyEntry = async (entry: PortEntry) => {
    const url = entry.url ?? `http://127.0.0.1:${entry.port}`;
    try {
      await copyText(url);
      setMessage(`Copied ${url}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const copyDevContextForEntry = async (entry: PortEntry) => {
    const profile = profileForEntry(entry);
    try {
      await copyText(
        formatDevContext({
          entry,
          profile,
          profileHealth: profile ? profileHealthResults[profile.id] : undefined,
          doctorReport: analyzePortDoctor(entry, entries, settings.projectProfiles, profile?.id),
          staleSignal: detectStaleProcess(entry, profile)
        })
      );
      setMessage(`Copied dev context for ${profile?.name ?? `port ${entry.port}`}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const copyWorkspaceContext = async (state: (typeof workspaceStates)[number]) => {
    try {
      await copyText(formatWorkspaceContext(state));
      setMessage(`Copied workspace context for ${state.workspace.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const copyProfileContext = async (state: ProfileState) => {
    try {
      await copyText(formatProfileContext(state));
      setMessage(`Copied profile context for ${state.profile.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const profileStateForProfile = (profile: ProjectProfile): ProfileState =>
    profileStates.find((state) => state.profile.id === profile.id) ?? {
      profile,
      status: "stopped",
      healthLabel: "No running port"
    };

  const copyProfileContextForProfile = async (profile: ProjectProfile) => {
    await copyProfileContext(profileStateForProfile(profile));
  };

  const openProfileApp = (profile: ProjectProfile) => {
    if (!profile.mainUrl) {
      setMessage(`Profile ${profile.name} has no main URL configured`);
      return;
    }
    openExternalUrl(profile.mainUrl, profile.preferredOpenMode);
  };

  const copyScanContext = async () => {
    try {
      await copyText(
        formatScanContext({
          entries: visibleEntries.map((entry) => {
            const profile = profileForEntry(entry);
            return {
              entry,
              profile,
              profileHealth: profile ? profileHealthResults[profile.id] : undefined,
              staleSignal: detectStaleProcess(entry, profile)
            };
          }),
          totalCount: entries.length,
          filterLabel: filterLabel(filter),
          query,
          scannedAt: scanResult?.scannedAt
        })
      );
      setMessage(`Copied scan context for ${visibleEntries.length} visible ${visibleEntries.length === 1 ? "port" : "ports"}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const copyDoctorAdvice = async (entry: PortEntry, report: PortDoctorReport) => {
    try {
      await copyText(formatPortDoctorAdvice(report));
      setMessage(`Copied doctor advice for port ${entry.port}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const copyStaleAdvice = async (entry: PortEntry, signal: StaleProcessSignal) => {
    try {
      await copyText(formatStaleProcessAdvice(entry, signal));
      setMessage(`Copied stale advice for port ${entry.port}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const copyProfileLogs = async (profile: ProjectProfile) => {
    try {
      await copyText(formatProfileLogs(profile));
      setMessage(`Copied logs for ${profile.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const exportSettings = () => {
    const blob = new Blob([exportSettingsBundle(settings)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "localhost-control-settings.json";
    link.click();
    URL.revokeObjectURL(url);
    setMessage(settingsExportSummary(settings));
  };

  const importSettingsFile = async (file: File | undefined) => {
    if (!file) return;

    try {
      const result = importSettingsBundle(await readFileText(file));
      if (!result.ok) {
        setMessage(result.error);
        return;
      }

      if (await replaceSettings(result.settings)) {
        setMessage(result.summary);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (importFileRef.current) importFileRef.current.value = "";
    }
  };

  const openTerminalForEntry = async (entry: PortEntry) => {
    try {
      const result = await client.openTerminal({
        ...(entry.projectHint ? { projectHint: entry.projectHint } : {}),
        ...(entry.commandLine ? { commandLine: entry.commandLine } : {})
      });
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const copyProfileCommand = async (profile: ProjectProfile) => {
    if (!profile.startCommand) return;
    try {
      await copyText(profile.startCommand);
      setMessage(`Copied command for ${profile.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const openTerminalForProfile = async (profile: ProjectProfile) => {
    try {
      const result = await client.openTerminal({
        ...(profile.projectPath ? { projectHint: profile.projectPath } : {}),
        ...(profile.startCommand ? { commandLine: profile.startCommand } : {})
      });
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const startProfile = async (profile: ProjectProfile) => {
    if (!isTrustedStartableProjectProfile(settings, profile)) {
      setMessage(`Profile ${profile.name} is missing a trusted path or command`);
      return;
    }

    try {
      const startResult = await startPreparedProfile(profile);
      if (!startResult.ok) return;

      const fallbackDetail = fallbackDetailForStart(profile, startResult);
      if (startResult.profile.healthUrl) {
        void recordAction({
          action: "start-profile",
          target: profile.name,
          detail: fallbackDetail ?? "Waiting for health check"
        });
        void waitForProfileReady(startResult.profile);
        if (startResult.portChanged && startResult.selectedPort) {
          setMessage(`Started ${profile.name} on clean port ${startResult.selectedPort}; saved profile URLs updated.`);
        }
        return;
      }
      void recordAction({
        action: "start-profile",
        target: profile.name,
        ...(fallbackDetail ? { detail: fallbackDetail } : {})
      });
      void waitForProfileObserved(startResult.profile);
      setMessage(
        startResult.portChanged && startResult.selectedPort
          ? `Started ${profile.name} on clean port ${startResult.selectedPort}; saved profile URLs updated.`
          : `Started profile ${profile.name}`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const cleanupBrowserDataForEntry = async (entry: PortEntry, mode: BrowserCleanupMode = "all") => {
    const url = entry.url ?? `http://127.0.0.1:${entry.port}`;
    try {
      const result = await clearBrowserDataForUrl(url, mode);
      void recordAction({
        action: "browser-cleanup",
        target: new URL(url).origin,
        detail: mode === "cache" ? "Cache and service workers" : "Origin storage"
      });
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const openPrivateWindowForEntry = async (entry: PortEntry) => {
    const url = entry.url ?? `http://127.0.0.1:${entry.port}`;
    try {
      const result = await openPrivateWindowForUrl(url);
      if (result.opened) {
        void recordAction({
          action: "open-private-window",
          target: result.origin
        });
      }
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const hardReloadTabsForEntry = async (entry: PortEntry) => {
    const url = entry.url ?? `http://127.0.0.1:${entry.port}`;
    try {
      const result = await reloadLocalhostTabsForUrl(url);
      if (result.reloaded) {
        void recordAction({
          action: "hard-reload-tabs",
          target: result.origin,
          detail: `${result.count} ${result.count === 1 ? "tab" : "tabs"}`
        });
      }
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const openMobilePreviewForEntry = async (entry: PortEntry, preset: BrowserPreviewPreset = "phone") => {
    const url = entry.url ?? `http://127.0.0.1:${entry.port}`;
    try {
      const result = await openMobilePreviewForUrl(url, preset);
      if (result.opened) {
        void recordAction({
          action: "open-mobile-preview",
          target: result.origin,
          detail: `${preset} preview`
        });
      }
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const openProjectFolderForEntry = async (entry: PortEntry) => {
    const profile = profileForEntry(entry);
    const projectPath = projectFolderPathForEntry(entry);
    if (!projectPath) {
      setMessage("Trust the project path before opening its folder.");
      return;
    }

    try {
      const result = await client.openProjectFolder({ projectPath });
      if (result.opened) {
        void recordAction({
          action: "open-project-folder",
          target: profile?.name ?? projectPath,
          detail: projectPath
        });
      }
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const openProjectFolderForProfile = async (profile: ProjectProfile) => {
    const projectPath = projectFolderPathForProfile(profile);
    if (!projectPath) {
      setMessage("Trust the project path before opening its folder.");
      return;
    }

    try {
      const result = await client.openProjectFolder({ projectPath });
      if (result.opened) {
        void recordAction({
          action: "open-project-folder",
          target: profile.name,
          detail: projectPath
        });
      }
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const checkHealthForProfile = async (profile: ProjectProfile) => {
    const requestSeq = (profileHealthRequestSeqRef.current[profile.id] ?? 0) + 1;
    profileHealthRequestSeqRef.current[profile.id] = requestSeq;
    const result = await checkProfileHealth(profile);
    if (profileHealthRequestSeqRef.current[profile.id] !== requestSeq) return;
    setProfileHealthResults((current) => ({ ...current, [profile.id]: result }));
    setMessage(result.message);
  };

  const preflightHealthForProfileStart = async (profile: ProjectProfile): Promise<boolean> => {
    const result = await preflightProfileHealthCheck(profile);
    if (!result) return true;
    setProfileHealthResults((current) => ({ ...current, [profile.id]: result }));
    setMessage(result.message);
    return false;
  };

  const persistPreparedProfile = async (profile: ProjectProfile): Promise<boolean> => {
    const previous = settingsRef.current;
    const next = upsertProjectProfile(previous, profile);
    settingsRef.current = next;
    setSettings(next);
    try {
      await saveSettings(next);
      return true;
    } catch (error) {
      settingsRef.current = previous;
      setSettings(previous);
      setMessage(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const startPreparedProfile = async (
    profile: StartableProjectProfile,
    options: { skipRunningGuard?: boolean; skipHealthPreflight?: boolean; avoidPorts?: number[] } = {}
  ): Promise<PreparedProfileStartResult> => {
    const runningEntry = profileStateForProfile(profile).entry;
    if (!options.skipRunningGuard && runningEntry) {
      const message = `${profile.name} is already running on port ${runningEntry.port}.`;
      setMessage(message);
      return { ok: false, message };
    }

    let preparedProfile: StartableProjectProfile = profile;
    let portChanged = false;
    let selectedPort: number | undefined;
    let shouldPersistPreparedProfile = false;

    const canonicalized = canonicalizeProfileStartCommand(preparedProfile);
    if (!canonicalized.ok) {
      setMessage(canonicalized.message);
      return { ok: false, message: canonicalized.message };
    }
    if (canonicalized.changed) {
      preparedProfile = canonicalized.profile as StartableProjectProfile;
      shouldPersistPreparedProfile = true;
    }

    const preferredPort = preferredProfilePort(preparedProfile);

    if (preferredPort) {
      const portResult = await client.resolveStartPort({
        preferredPort,
        ...(options.avoidPorts?.length ? { avoidPorts: [...options.avoidPorts] } : {}),
        searchLimit: 50
      });
      if (!options.skipRunningGuard && portResult.changed && portResult.occupiedBy && scoreProfileForEntry(portResult.occupiedBy, profile) >= 100) {
        const message = `${profile.name} is already running on port ${portResult.occupiedBy.port}.`;
        setMessage(message);
        void waitForProfileObserved(profile);
        return { ok: false, message };
      }
      selectedPort = portResult.selectedPort;
      if (portResult.changed) {
        const retargeted = retargetProfilePort(preparedProfile, preferredPort, portResult.selectedPort);
        if (!retargeted.ok) {
          setMessage(retargeted.message);
          return { ok: false, message: retargeted.message };
        }
        preparedProfile = retargeted.profile as StartableProjectProfile;
        portChanged = true;
        shouldPersistPreparedProfile = true;
      }
    }

    if (!options.skipHealthPreflight && preparedProfile.healthUrl && !(await preflightHealthForProfileStart(preparedProfile))) {
      return { ok: false, message: `Health preflight failed for ${preparedProfile.name}` };
    }

    const result = await client.openTerminal({
      projectHint: preparedProfile.projectPath,
      commandLine: preparedProfile.startCommand,
      executeCommand: true
    });
    if (!result.opened) {
      setMessage(result.message);
      return { ok: false, message: result.message };
    }
    if (shouldPersistPreparedProfile && !(await persistPreparedProfile(preparedProfile))) {
      return { ok: false, message: `Could not save updated profile ${profile.name}` };
    }

    return {
      ok: true,
      profile: preparedProfile,
      portChanged,
      ...(selectedPort ? { selectedPort } : {})
    };
  };

  const waitForProfileReady = async (profile: ProjectProfile) => {
    const requestSeq = (profileHealthRequestSeqRef.current[profile.id] ?? 0) + 1;
    profileHealthRequestSeqRef.current[profile.id] = requestSeq;
    const checkingResult = checkingProfileHealthResult(profile);
    setProfileHealthResults((current) => ({ ...current, [profile.id]: checkingResult }));
    setMessage(checkingResult.message);

    let lastResult: ProfileHealthResult | undefined;
    for (let attempt = 0; attempt < profileReadyPollAttempts; attempt += 1) {
      if (attempt > 0) await delay(profileReadyPollDelayMs);
      const result = await checkProfileHealth(profile, fetch, { timeoutMs: 1500 });
      if (profileHealthRequestSeqRef.current[profile.id] !== requestSeq) return;
      lastResult = result;
      setProfileHealthResults((current) => ({ ...current, [profile.id]: result }));
      if (result.state === "healthy") {
        const readyMessage = `${profile.name} is ready (${result.statusCode ?? "ok"})`;
        setMessage(readyMessage);
        void scanForProfileObservation();
        void notifyProfileHealth("ready", profile, readyMessage);
        return;
      }
      if (result.state === "blocked") {
        setMessage(result.message);
        return;
      }
    }

    const failedMessage = lastResult ? `${profile.name} did not become healthy: ${lastResult.message}` : `${profile.name} did not become healthy.`;
    setMessage(failedMessage);
    void notifyProfileHealth("failed", profile, failedMessage);
  };

  const waitForProfileObserved = async (profile: ProjectProfile): Promise<boolean> => {
    for (let attempt = 0; attempt < profileObservePollAttempts; attempt += 1) {
      if (attempt > 0) await delay(profileObservePollDelayMs);
      try {
        const result = await scanForProfileObservation();
        if (scanResultProfileEntry(profile, result)) return true;
      } catch (error) {
        setHostError(error instanceof Error ? error.message : String(error));
      }
    }
    return false;
  };

  const saveProfileForEntry = async (entry: PortEntry) => {
    const existingProfile = profileForEntry(entry);
    const nextTrustedPaths =
      entry.projectHint && !isTrustedProjectPath(settings, entry.projectHint)
        ? [...settings.trustedProjectPaths, entry.projectHint]
        : settings.trustedProjectPaths;

    if (existingProfile) {
      const nextProfile: ProjectProfile = {
        ...existingProfile,
        expectedPort: existingProfile.expectedPort ?? entry.port,
        mainUrl: existingProfile.mainUrl ?? entry.url ?? `http://127.0.0.1:${entry.port}`
      };
      if (entry.projectHint && !nextProfile.projectPath) nextProfile.projectPath = entry.projectHint;
      if (entry.commandLine && !nextProfile.startCommand) nextProfile.startCommand = entry.commandLine;

      const changed =
        nextProfile.projectPath !== existingProfile.projectPath ||
        nextProfile.startCommand !== existingProfile.startCommand ||
        nextProfile.expectedPort !== existingProfile.expectedPort ||
        nextProfile.mainUrl !== existingProfile.mainUrl ||
        nextTrustedPaths !== settings.trustedProjectPaths;
      if (!changed) {
        setMessage(`Profile ${existingProfile.name} is already saved`);
        return;
      }
      if (
        !(await patchSettings({
          projectProfiles: settings.projectProfiles.map((profile) => (profile.id === existingProfile.id ? nextProfile : profile)),
          trustedProjectPaths: nextTrustedPaths
        }))
      ) {
        return;
      }
      setMessage(
        nextProfile.startCommand && !existingProfile.startCommand
          ? `Updated profile ${existingProfile.name} with start command`
          : `Updated profile ${existingProfile.name}`
      );
      return;
    }

    const name = entry.title ?? entry.projectHint?.split(/[\\/]/).pop() ?? `${entry.processName} ${entry.port}`;
    const baseId = slugifyLocalId(name);
    const existingIds = new Set(settings.projectProfiles.map((profile) => profile.id));
    let id = baseId;
    let suffix = 2;
    while (existingIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    const profile: ProjectProfile = {
      id,
      name,
      expectedPort: entry.port,
      mainUrl: entry.url ?? `http://127.0.0.1:${entry.port}`
    };
    if (entry.projectHint) profile.projectPath = entry.projectHint;
    if (entry.commandLine) profile.startCommand = entry.commandLine;

    if (!(await patchSettings({ projectProfiles: [...settings.projectProfiles, profile], trustedProjectPaths: nextTrustedPaths }))) return;
    setMessage(`Saved profile ${name}`);
  };

  const saveWorkspaceFromProfiles = async () => {
    const profiles = settings.projectProfiles;
    if (profiles.length < 2) return;
    if (hasWorkspaceForCurrentProfiles) {
      setMessage("Workspace already saved");
      return;
    }
    const name = `${profiles[0]?.name ?? "Workspace"} + ${profiles.length - 1}`;
    const baseId = slugifyLocalId(name);
    const existingIds = new Set(settings.projectWorkspaces.map((workspace) => workspace.id));
    let id = baseId;
    let suffix = 2;
    while (existingIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    const workspace: ProjectWorkspace = {
      id,
      name,
      profileIds: profiles.map((profile) => profile.id)
    };
    if (!(await patchSettings({ projectWorkspaces: [...settings.projectWorkspaces, workspace] }))) return;
    setMessage(`Saved workspace ${name}`);
  };

  const startWorkspace = async (state: (typeof workspaceStates)[number]) => {
    const startableProfiles = state.profileStates
      .filter((profileState) => profileState.status === "stopped")
      .map(({ profile }) => profile)
      .filter((profile) => isTrustedStartableProjectProfile(settings, profile));
    if (!startableProfiles.length) {
      setMessage(`No stopped profiles with safe start commands configured for ${state.workspace.name}`);
      return;
    }

    try {
      for (const profile of startableProfiles) {
        if (profile.healthUrl && !(await preflightHealthForProfileStart(profile))) return;
      }

      const startedProfiles: StartableProjectProfile[] = [];
      const avoidPorts: number[] = [];
      const fallbackDetails: string[] = [];
      for (const profile of startableProfiles) {
        const startResult = await startPreparedProfile(profile, { skipRunningGuard: true, skipHealthPreflight: true, avoidPorts });
        if (!startResult.ok) {
          setMessage(startResult.message);
          return;
        }
        startedProfiles.push(startResult.profile);
        const fallbackDetail = fallbackDetailForStart(profile, startResult);
        if (fallbackDetail) fallbackDetails.push(fallbackDetail);
        if (startResult.selectedPort) avoidPorts.push(startResult.selectedPort);
      }
      void recordAction({
        action: "start-workspace",
        target: state.workspace.name,
        detail: appendFallbackDetails(`${startedProfiles.length} ${startedProfiles.length === 1 ? "profile" : "profiles"}`, fallbackDetails)
      });
      const healthProfiles = startedProfiles.filter((profile) => profile.healthUrl);
      healthProfiles.forEach((profile) => void waitForProfileReady(profile));
      startedProfiles.filter((profile) => !profile.healthUrl).forEach((profile) => void waitForProfileObserved(profile));
      setMessage(
        `Started workspace ${state.workspace.name}: ${startedProfiles.length} ${
          startedProfiles.length === 1 ? "command" : "commands"
        }${healthProfiles.length ? `; waiting on ${healthProfiles.length} health ${healthProfiles.length === 1 ? "check" : "checks"}` : ""}`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const trustProject = async (entry: PortEntry) => {
    if (!entry.projectHint || settings.trustedProjectPaths.includes(entry.projectHint)) return;
    if (!(await patchSettings({ trustedProjectPaths: [...settings.trustedProjectPaths, entry.projectHint] }))) return;
    setFilter("web");
    setMessage(`Trusted ${entry.projectHint}`);
  };

  const trustProfileProject = async (profile: ProjectProfile) => {
    if (!profile.projectPath) {
      setMessage(`Profile ${profile.name} has no project path configured`);
      return;
    }
    if (isTrustedProjectPath(settings, profile.projectPath)) {
      setMessage(`${profile.name} is already trusted`);
      return;
    }
    if (!(await patchSettings({ trustedProjectPaths: [...settings.trustedProjectPaths, profile.projectPath] }))) return;
    setMessage(`Trusted ${profile.projectPath}`);
  };

  const hideProcess = async (entry: PortEntry) => {
    const processName = entry.processName.toLowerCase();
    if (settings.blockedProcessNames.map((name) => name.toLowerCase()).includes(processName)) return;
    if (!(await patchSettings({ blockedProcessNames: [...settings.blockedProcessNames, processName] }))) return;
    setSelectedKey(null);
    setMessage(`Hidden ${entry.processName} from Dev apps`);
  };

  if (hostError) {
    return (
      <main className="app-shell offline">
        <section className="offline-panel">
          <ShieldAlert size={28} />
          <h1>Native host offline</h1>
          <p>{hostError}</p>
          <p>Install the Localhost Control native host for your operating system, then retry the connection.</p>
          <button className="primary-button" type="button" onClick={openNativeHostDownload}>
            <Download size={15} />
            Download native host
          </button>
          <button className="primary-button" type="button" onClick={() => void scan()}>
            Retry connection
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>Localhost Control</h1>
          <p aria-live="polite">{message || "Ready to scan local development ports"}</p>
        </div>
        <IconButton label="Refresh ports" tone="primary" onClick={() => void scan()} disabled={busy}>
          <RefreshCw size={17} className={busy ? "spin" : ""} />
        </IconButton>
      </header>

      <section className="summary-strip" aria-label="Scan summary">
        <span><strong>{entries.length}</strong> ports</span>
        <span><strong>{killableCount}</strong> kill</span>
        <span><strong>{protectedCount}</strong> protected</span>
        <span>{scanResult ? new Date(scanResult.scannedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--:--"}</span>
        <button className="summary-action" type="button" onClick={() => void copyScanContext()} aria-label="Copy scan context" title="Copy scan context">
          <Copy size={13} />
        </button>
      </section>

      <nav className="app-tabs" aria-label="App sections">
        <button
          className={activeView === "dev" ? "active" : ""}
          type="button"
          aria-label="Show Dev apps view"
          onClick={() => showView("dev")}
        >
          <Terminal size={14} />
          Dev apps
          <span>{visibleEntries.length}</span>
        </button>
        <button
          className={activeView === "favorites" ? "active" : ""}
          type="button"
          aria-label="Show Favorites view"
          onClick={() => showView("favorites")}
        >
          <Star size={14} />
          Favorites
          <span>{savedItemCount}</span>
        </button>
      </nav>

      {activeView === "dev" ? (
        <>
          <div className="search-row">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search port, process, path" aria-label="Search ports" />
          </div>

          <nav className="filters" aria-label="Port filters">
            {filters.map((item) => (
              <button className={filter === item ? "active" : ""} key={item} type="button" onClick={() => setFilter(item)}>
                {filterLabel(item)}
              </button>
            ))}
          </nav>
          {filter === "custom" ? (
            <label className="custom-range">
              <span>Range</span>
              <input
                aria-label="Custom port range"
                value={settings.customPortRange}
                onChange={(event) => void patchSettings({ customPortRange: event.target.value })}
                placeholder="3000-9999, 17321"
              />
            </label>
          ) : null}
        </>
      ) : null}

      {activeView === "favorites" ? (
        <section className="favorites-view" aria-label="Favorites">
          {workspaceStates.length ? (
            <section className="workspace-strip" aria-label="Project workspaces">
              {workspaceStates.map((state) => {
                const stoppableEntries = stopWorkspaceEntries(state);
                const restartableEntries = restartWorkspaceEntries(state);
                const failedRestartableEntries = restartWorkspaceEntries(state, "failed");
                return (
                  <article className={`workspace-chip ${state.status}`} key={state.workspace.id}>
                    <button className="workspace-summary" type="button" onClick={() => state.openUrls.forEach((url) => openExternalUrl(url))} aria-label={`Open workspace ${state.workspace.name}`}>
                      <span className="workspace-name">{state.workspace.name}</span>
                      <span className="workspace-health">{state.healthLabel}</span>
                      {state.workspace.notes ? <span className="workspace-notes">{state.workspace.notes}</span> : null}
                    </button>
                    <div className="workspace-actions">
                      <button type="button" onClick={() => void copyWorkspaceContext(state)} aria-label={`Copy workspace context ${state.workspace.name}`}>
                        <Copy size={13} />
                        Context
                      </button>
                      <button type="button" onClick={() => void startWorkspace(state)} aria-label={`Start workspace ${state.workspace.name}`}>
                        <Terminal size={13} />
                        Start
                      </button>
                      {restartableEntries.length ? (
                        <button type="button" onClick={() => requestRestartWorkspace(state)} aria-label={`Restart workspace ${state.workspace.name}`}>
                          <RefreshCw size={12} />
                          Restart
                        </button>
                      ) : null}
                      {failedRestartableEntries.length ? (
                        <button type="button" onClick={() => requestRestartWorkspace(state, "failed")} aria-label={`Restart failed workspace ${state.workspace.name}`}>
                          <RefreshCw size={12} />
                          Failed
                        </button>
                      ) : null}
                      {stoppableEntries.length ? (
                        <button type="button" onClick={() => requestStopWorkspace(state)} aria-label={`Stop workspace ${state.workspace.name}`}>
                          <Square size={12} />
                          Stop
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </section>
          ) : null}

          {profileStates.length ? (
            <section className="profile-strip" aria-label="Project profiles">
              {profileStates.map((state) => {
                const trustedStartable = isTrustedStartableProjectProfile(settings, state.profile);
                const startTitle = trustedStartable
                  ? `Start profile ${state.profile.name}`
                  : isStartableProjectProfile(state.profile)
                    ? "Trust this project path before starting"
                    : "Update this profile from a running app to capture a start command";
                return (
                  <article
                    className={`profile-chip ${state.status}`}
                    key={state.profile.id}
                  >
                    <button
                      className="profile-summary"
                      type="button"
                      aria-label={`Show profile controls ${state.profile.name}`}
                      onClick={() => {
                        setSelectedProfileId(state.profile.id);
                        if (state.entry) setSelectedKey(`${state.entry.pid}:${state.entry.port}`);
                      }}
                    >
                      <ProfileLogo profile={state.profile} />
                      <span className="profile-copy">
                        <span className="profile-name">{state.profile.name}</span>
                        <span className="profile-status">{state.status}</span>
                        <span className="profile-health">{state.healthLabel}</span>
                      </span>
                    </button>
                    <div className="profile-actions">
                      <button type="button" onClick={() => void copyProfileContext(state)} aria-label={`Copy profile context ${state.profile.name}`}>
                        <Copy size={13} />
                        Context
                      </button>
                      {!state.entry ? (
                        <button
                          type="button"
                          onClick={() => void startProfile(state.profile)}
                          aria-label={`Start profile ${state.profile.name}`}
                          disabled={!trustedStartable}
                          title={startTitle}
                        >
                          <Terminal size={13} />
                          Start
                        </button>
                      ) : null}
                      {state.entry?.killable ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (state.entry?.killable) requestKillEntry(state.entry);
                          }}
                          aria-label={`Stop profile ${state.profile.name}`}
                        >
                          <Square size={12} />
                          Stop
                        </button>
                      ) : null}
                      {state.entry?.killable && trustedStartable ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (state.entry?.killable) requestRestartProfile(state.profile, state.entry);
                          }}
                          aria-label={`Restart profile ${state.profile.name}`}
                        >
                          <RefreshCw size={12} />
                          Restart
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
              {settings.projectProfiles.length >= 2 && !hasWorkspaceForCurrentProfiles ? (
                <button className="profile-chip action" type="button" onClick={() => void saveWorkspaceFromProfiles()}>
                  <span className="profile-name">
                    <FolderPlus size={14} />
                    Save workspace
                  </span>
                  <span className="profile-health">{settings.projectProfiles.length} profiles</span>
                </button>
              ) : null}
            </section>
          ) : null}
          {!profileStates.length && !workspaceStates.length ? (
            <section className="favorites-empty" aria-label="No favorites">
              <strong>No favorites saved</strong>
              <span>Save a running dev app to start it again later.</span>
            </section>
          ) : null}
        </section>
      ) : null}

      {activeView === "dev" ? (
        <PortList
          entries={visibleEntries}
          selectedKey={selectedListEntry ? `${selectedListEntry.pid}:${selectedListEntry.port}` : null}
          profileNameForEntry={(entry) => profileForEntry(entry)?.name}
          staleSignalForEntry={staleSignalForEntry}
          onSelect={(entry) => {
            setSelectedKey(`${entry.pid}:${entry.port}`);
            setSelectedProfileId(null);
          }}
          onOpen={openEntry}
          onKill={requestKillEntry}
        />
      ) : null}

      <DetailPanel
        entry={detailEntry}
        profile={detailProfile}
        profileStatus={activeView === "favorites" ? selectedProfileState?.status : undefined}
        profileHealthLabel={activeView === "favorites" ? selectedProfileState?.healthLabel : undefined}
        profileHealth={detailProfileHealth}
        doctorReport={selectedDoctorReport}
        staleSignal={selectedStaleSignal}
        projectFolderPath={detailProjectFolderPath}
        canStartProfile={detailProfile ? isTrustedStartableProjectProfile(settings, detailProfile) : false}
        profileStartTitle={
          detailProfile
            ? isTrustedStartableProjectProfile(settings, detailProfile)
              ? `Start profile ${detailProfile.name}`
              : isStartableProjectProfile(detailProfile)
                ? "Trust this project path before starting"
                : "Update this profile from a running app to capture a start command"
            : undefined
        }
        onKill={requestKillEntry}
        onOpen={openEntry}
        onCopy={(entry) => void copyEntry(entry)}
        onCopyDevContext={(entry) => void copyDevContextForEntry(entry)}
        onOpenProfile={(profile) => openProfileApp(profile)}
        onStartProfile={(profile) => void startProfile(profile)}
        onCopyProfileContext={(profile) => void copyProfileContextForProfile(profile)}
        onCopyProfileLogs={(profile) => void copyProfileLogs(profile)}
        onTerminal={(entry) => void openTerminalForEntry(entry)}
        onCleanup={(entry, mode) => void cleanupBrowserDataForEntry(entry, mode)}
        onHardReload={(entry) => void hardReloadTabsForEntry(entry)}
        onOpenPrivate={(entry) => void openPrivateWindowForEntry(entry)}
        onOpenMobilePreview={(entry, preset) => void openMobilePreviewForEntry(entry, preset)}
        onOpenProjectFolder={(entry) => void openProjectFolderForEntry(entry)}
        onOpenProfileFolder={(profile) => void openProjectFolderForProfile(profile)}
        onCopyProfileCommand={(profile) => void copyProfileCommand(profile)}
        onOpenProfileTerminal={(profile) => void openTerminalForProfile(profile)}
        onCheckProfileHealth={(profile) => void checkHealthForProfile(profile)}
        onCopyDoctorAdvice={(entry, report) => void copyDoctorAdvice(entry, report)}
        onCopyStaleAdvice={(entry, signal) => void copyStaleAdvice(entry, signal)}
        onSaveProfile={(entry) => void saveProfileForEntry(entry)}
        onTrustProject={(entry) => void trustProject(entry)}
        onTrustProfile={(profile) => void trustProfileProject(profile)}
        onHideProcess={(entry) => void hideProcess(entry)}
      />

      {pendingKillEntry ? (
        <SafeActionDialog
          entry={pendingKillEntry}
          profile={profileForEntry(pendingKillEntry)}
          onCancel={() => setPendingKillEntry(null)}
          onConfirm={(entry, mode) => void confirmKillEntry(entry, mode)}
        />
      ) : null}

      {pendingProfileRestart ? (
        <SafeActionDialog
          action="restart"
          entry={pendingProfileRestart.entry}
          profile={pendingProfileRestart.profile}
          onCancel={() => setPendingProfileRestart(null)}
          onConfirm={(_entry, mode) => void confirmRestartProfile(pendingProfileRestart, mode)}
        />
      ) : null}

      {pendingWorkspaceStop ? (
        <WorkspaceActionDialog
          workspace={pendingWorkspaceStop.workspace}
          profiles={stopWorkspaceEntries(pendingWorkspaceStop)}
          onCancel={() => setPendingWorkspaceStop(null)}
          onConfirm={() => void confirmStopWorkspace(pendingWorkspaceStop)}
        />
      ) : null}

      {pendingWorkspaceRestart ? (
        <WorkspaceActionDialog
          action={pendingWorkspaceRestart.mode === "failed" ? "restart-failed" : "restart"}
          workspace={pendingWorkspaceRestart.state.workspace}
          profiles={restartWorkspaceEntries(pendingWorkspaceRestart.state, pendingWorkspaceRestart.mode)}
          onCancel={() => setPendingWorkspaceRestart(null)}
          onConfirm={() => void confirmRestartWorkspace(pendingWorkspaceRestart.state, pendingWorkspaceRestart.mode)}
        />
      ) : null}

      {settingsManagerOpen ? (
        <SettingsManager
          settings={settings}
          saving={settingsActionSaving}
          onSaveProfile={(profile) => applySettingsAction(upsertProjectProfile(settings, profile), `Saved profile ${profile.name}`)}
          onRemoveProfile={(profileId, name) => void applySettingsAction(removeProjectProfile(settings, profileId), `Removed profile ${name}`)}
          onRemoveWorkspace={(workspaceId, name) => void applySettingsAction(removeProjectWorkspace(settings, workspaceId), `Removed workspace ${name}`)}
          onRemoveTrustedRoot={(path) =>
            void applySettingsAction(removeTrustedProjectRoot(settings, path), `Removed trusted path ${path}`)
          }
          onRemoveTrustedPath={(path) => void applySettingsAction(removeTrustedProjectPath(settings, path), `Removed trusted path ${path}`)}
          onUnhidePort={(port) => void applySettingsAction(unhidePort(settings, port), `Unhid port ${port}`)}
          onUnblockProcess={(processName) => void applySettingsAction(unblockProcessName(settings, processName), `Unblocked process ${processName}`)}
          onClearAudit={() => void clearAuditHistory()}
        />
      ) : null}

      <footer className="settings-bar">
        <Settings2 size={15} />
        <select
          className="theme-select"
          aria-label="Theme"
          value={settings.themeMode}
          onChange={(event) => void patchSettings({ themeMode: event.target.value as Settings["themeMode"] })}
        >
          <option value="system">system</option>
          <option value="light">light</option>
          <option value="dark">dark</option>
        </select>
        <label>
          <input
            type="checkbox"
            checked={settings.includeSystemPorts}
            onChange={(event) => void patchSettings({ includeSystemPorts: event.target.checked })}
          />
          system ports
        </label>
        <label>
          <input type="checkbox" checked={settings.httpProbe} onChange={(event) => void patchSettings({ httpProbe: event.target.checked })} />
          probe HTTP
        </label>
        <select
          className="refresh-select"
          aria-label="Auto refresh interval"
          value={settings.refreshIntervalSec}
          onChange={(event) => void patchSettings({ refreshIntervalSec: Number(event.target.value) })}
        >
          <option value={0}>manual</option>
          <option value={10}>10s</option>
          <option value={30}>30s</option>
          <option value={60}>60s</option>
        </select>
        <button className="settings-command" type="button" aria-label="Export settings" title="Export settings" onClick={exportSettings}>
          <Download size={13} />
          Export
        </button>
        <button className="settings-command" type="button" aria-label="Import settings" title="Import settings" onClick={() => importFileRef.current?.click()}>
          <Upload size={13} />
          Import
        </button>
        <button
          className="settings-command"
          type="button"
          aria-expanded={settingsManagerOpen}
          aria-controls="settings-manager"
          aria-label="Manage settings"
          title="Manage settings"
          onClick={() => setSettingsManagerOpen((current) => !current)}
        >
          <SlidersHorizontal size={13} />
          Manage
        </button>
        <input
          ref={importFileRef}
          className="settings-file-input"
          type="file"
          accept="application/json,.json"
          aria-label="Import settings file"
          tabIndex={-1}
          onChange={(event) => void importSettingsFile(event.currentTarget.files?.[0])}
        />
      </footer>
    </main>
  );
};
