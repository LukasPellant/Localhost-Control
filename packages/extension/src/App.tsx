import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, FolderPlus, RefreshCw, Search, Settings2, ShieldAlert, SlidersHorizontal, Terminal, Upload } from "lucide-react";
import { withAppScope, type KillParams, type PortEntry, type ScanResult } from "@localhost-control/shared";
import { DetailPanel } from "./components/DetailPanel";
import { IconButton } from "./components/IconButton";
import { PortList } from "./components/PortList";
import { SafeActionDialog } from "./components/SafeActionDialog";
import { SettingsManager } from "./components/SettingsManager";
import { clearBrowserDataForUrl, type BrowserCleanupMode } from "./lib/browserCleanup";
import { appendActionAuditEntry, createActionAuditEntry, type ActionAuditInput } from "./lib/actionAudit";
import { formatDevContext } from "./lib/devContext";
import { getExtensionApi } from "./lib/extensionApi";
import { type HostClient } from "./lib/hostClient";
import { analyzePortDoctor, formatPortDoctorAdvice, type PortDoctorReport } from "./lib/portDoctor";
import { filterEntries, filterLabel, type FilterId } from "./lib/portFilters";
import { checkProfileHealth, type ProfileHealthResult } from "./lib/profileHealth";
import { deriveProfileStates, matchProfileForEntry, type ProfileState, type ProjectProfile } from "./lib/projectProfiles";
import { deriveWorkspaceStates, type ProjectWorkspace } from "./lib/projectWorkspaces";
import { defaultSettings, loadSettings, saveActionAudit, saveSettings, type Settings } from "./lib/settings";
import {
  removeProjectProfile,
  removeProjectWorkspace,
  removeTrustedProjectRoot,
  removeTrustedProjectPath,
  clearActionAudit,
  unblockProcessName,
  unhidePort
} from "./lib/settingsActions";
import { exportSettingsBundle, importSettingsBundle } from "./lib/settingsBundle";
import { detectStaleProcess } from "./lib/staleProcesses";
import "./styles.css";

const filters: FilterId[] = ["web", "custom", "all", "node", "python", "unknown", "protected"];
const themeQuery = "(prefers-color-scheme: dark)";
const nativeHostReleasesUrl = "https://github.com/LukasPellant/Localhost-Control/releases";

type AppProps = {
  client: HostClient;
};

type StartableProjectProfile = ProjectProfile & {
  projectPath: string;
  startCommand: string;
};

const isMissingNativeHostError = (message: string): boolean =>
  /native messaging host.*not found|specified native messaging host not found|no such native application/i.test(message);
const nativeHostDownloadUrl = (): string => {
  const version = getExtensionApi()?.runtime?.getManifest?.().version;
  return version ? `${nativeHostReleasesUrl}/tag/v${version}` : nativeHostReleasesUrl;
};
const slugifyProfileName = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "project";
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
const checkingProfileHealthResult = (profile: ProjectProfile): ProfileHealthResult => ({
  profileId: profile.id,
  state: "checking",
  label: "Waiting for health",
  checkedAt: new Date().toISOString(),
  message: `Waiting for ${profile.name} health check...`
});

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
  const [profileHealthResults, setProfileHealthResults] = useState<Record<string, ProfileHealthResult>>({});
  const [settingsManagerOpen, setSettingsManagerOpen] = useState(false);
  const [settingsActionSaving, setSettingsActionSaving] = useState(false);
  const settingsActionSavingRef = useRef(false);
  const settingsRef = useRef(settings);
  const auditSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const profileHealthRequestSeqRef = useRef<Record<string, number>>({});
  const openedDownloadForError = useRef(false);
  const importFileRef = useRef<HTMLInputElement | null>(null);

  const openExternalUrl = useCallback((url: string) => {
    const tabs = getExtensionApi()?.tabs;
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

  useEffect(() => {
    void scan();
  }, [scan]);

  useEffect(() => {
    if (!settingsManagerOpen) return;
    window.setTimeout(() => document.getElementById("settings-manager")?.focus(), 0);
  }, [settingsManagerOpen]);

  useEffect(() => {
    if (!hostError || openedDownloadForError.current || !isMissingNativeHostError(hostError)) return;
    if (!getExtensionApi()?.tabs?.create) return;
    openedDownloadForError.current = true;
    openNativeHostDownload();
  }, [hostError, openNativeHostDownload]);

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
  const selectedEntry = useMemo(
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
  const selectedProfile = selectedEntry ? profileForEntry(selectedEntry) : undefined;
  const selectedProfileHealth = selectedProfile ? profileHealthResults[selectedProfile.id] : undefined;
  const workspaceStates = useMemo(
    () => deriveWorkspaceStates(settings.projectWorkspaces, settings.projectProfiles, profileStates),
    [profileStates, settings.projectProfiles, settings.projectWorkspaces]
  );
  const hasWorkspaceForCurrentProfiles = useMemo(() => {
    const profileIds = settings.projectProfiles.map((profile) => profile.id);
    if (profileIds.length < 2) return false;
    return settings.projectWorkspaces.some(
      (workspace) => workspace.profileIds.length === profileIds.length && workspace.profileIds.every((profileId, index) => profileId === profileIds[index])
    );
  }, [settings.projectProfiles, settings.projectWorkspaces]);
  const selectedDoctorReport = useMemo(
    () => (selectedEntry ? analyzePortDoctor(selectedEntry, entries, settings.projectProfiles, selectedProfile?.id) : undefined),
    [entries, selectedEntry, selectedProfile?.id, settings.projectProfiles]
  );
  const staleSignalForEntry = useCallback(
    (entry: PortEntry) => detectStaleProcess(entry, profileForEntry(entry)),
    [profileForEntry]
  );
  const selectedStaleSignal = selectedEntry ? staleSignalForEntry(selectedEntry) : undefined;
  const killableCount = entries.filter((entry) => entry.killable).length;
  const protectedCount = entries.length - killableCount;

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

  const applySettingsAction = async (next: Settings, successMessage: string) => {
    if (settingsActionSavingRef.current) return;
    settingsActionSavingRef.current = true;
    setSettingsActionSaving(true);
    try {
      if (!(await replaceSettings(next))) return;
      setMessage(successMessage);
      window.setTimeout(() => document.getElementById("settings-manager")?.focus(), 0);
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

  const confirmKillEntry = async (entry: PortEntry) => {
    if (!entry.killable) return;

    setBusy(true);
    setPendingKillEntry(null);
    const params: KillParams = { pid: entry.pid, port: entry.port, mode: "force-tree" };
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
      await recordAction({
        action: "stop-process",
        target: `${entry.processName} on port ${entry.port}`,
        detail: `PID ${entry.pid}`
      });
      setMessage(result.message);
    } catch (error) {
      setScanResult(previousResult);
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

  const copyDoctorAdvice = async (entry: PortEntry, report: PortDoctorReport) => {
    try {
      await copyText(formatPortDoctorAdvice(report));
      setMessage(`Copied doctor advice for port ${entry.port}`);
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
      const result = await client.openTerminal({
        projectHint: profile.projectPath,
        commandLine: profile.startCommand,
        executeCommand: true
      });
      if (!result.opened) {
        setMessage(result.message);
        return;
      }
      if (profile.healthUrl) {
        void recordAction({ action: "start-profile", target: profile.name, detail: "Waiting for health check" });
        void waitForProfileReady(profile);
        return;
      }
      void recordAction({ action: "start-profile", target: profile.name });
      setMessage(`Started profile ${profile.name}`);
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

  const checkHealthForProfile = async (profile: ProjectProfile) => {
    const requestSeq = (profileHealthRequestSeqRef.current[profile.id] ?? 0) + 1;
    profileHealthRequestSeqRef.current[profile.id] = requestSeq;
    const result = await checkProfileHealth(profile);
    if (profileHealthRequestSeqRef.current[profile.id] !== requestSeq) return;
    setProfileHealthResults((current) => ({ ...current, [profile.id]: result }));
    setMessage(result.message);
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
        setMessage(`${profile.name} is ready (${result.statusCode ?? "ok"})`);
        return;
      }
      if (result.state === "blocked") {
        setMessage(result.message);
        return;
      }
    }

    setMessage(lastResult ? `${profile.name} did not become healthy: ${lastResult.message}` : `${profile.name} did not become healthy.`);
  };

  const saveProfileForEntry = async (entry: PortEntry) => {
    if (profileForEntry(entry)) return;
    const name = entry.title ?? entry.projectHint?.split(/[\\/]/).pop() ?? `${entry.processName} ${entry.port}`;
    const baseId = slugifyProfileName(name);
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

    if (!(await patchSettings({ projectProfiles: [...settings.projectProfiles, profile] }))) return;
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
    const baseId = slugifyProfileName(name);
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
      .map(({ profile }) => profile)
      .filter((profile) => isTrustedStartableProjectProfile(settings, profile));
    if (!startableProfiles.length) {
      setMessage(`No safe start commands configured for ${state.workspace.name}`);
      return;
    }

    try {
      for (const profile of startableProfiles) {
        const result = await client.openTerminal({
          projectHint: profile.projectPath,
          commandLine: profile.startCommand,
          executeCommand: true
        });
        if (!result.opened) {
          setMessage(result.message);
          return;
        }
      }
      void recordAction({
        action: "start-workspace",
        target: state.workspace.name,
        detail: `${startableProfiles.length} ${startableProfiles.length === 1 ? "profile" : "profiles"}`
      });
      const healthProfiles = startableProfiles.filter((profile) => profile.healthUrl);
      healthProfiles.forEach((profile) => void waitForProfileReady(profile));
      setMessage(
        `Started workspace ${state.workspace.name}: ${startableProfiles.length} ${
          startableProfiles.length === 1 ? "command" : "commands"
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
        <span><strong>{killableCount}</strong> killable</span>
        <span><strong>{protectedCount}</strong> protected</span>
        <span>{scanResult ? new Date(scanResult.scannedAt).toLocaleTimeString() : "not scanned"}</span>
      </section>

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

      {workspaceStates.length ? (
        <section className="workspace-strip" aria-label="Project workspaces">
          {workspaceStates.map((state) => (
            <article className={`workspace-chip ${state.status}`} key={state.workspace.id}>
              <button className="workspace-summary" type="button" onClick={() => state.openUrls.forEach(openExternalUrl)} aria-label={`Open workspace ${state.workspace.name}`}>
                <span className="workspace-name">{state.workspace.name}</span>
                <span className="workspace-health">{state.healthLabel}</span>
                {state.workspace.notes ? <span className="workspace-notes">{state.workspace.notes}</span> : null}
              </button>
              <div className="workspace-actions">
                <button type="button" onClick={() => void startWorkspace(state)} aria-label={`Start workspace ${state.workspace.name}`}>
                  <Terminal size={13} />
                  Start
                </button>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {profileStates.length ? (
        <section className="profile-strip" aria-label="Project profiles">
          {profileStates.map((state) => (
            <article
              className={`profile-chip ${state.status}`}
              key={state.profile.id}
            >
              <button
                className="profile-summary"
                type="button"
                aria-label={`Open profile ${state.profile.name}`}
                onClick={() => {
                  if (state.entry) setSelectedKey(`${state.entry.pid}:${state.entry.port}`);
                  else if (state.profile.mainUrl) openExternalUrl(state.profile.mainUrl);
                }}
              >
                <span className="profile-name">{state.profile.name}</span>
                <span className="profile-status">{state.status}</span>
                <span className="profile-health">{state.healthLabel}</span>
              </button>
              {state.status === "stopped" && isTrustedStartableProjectProfile(settings, state.profile) ? (
                <div className="profile-actions">
                  <button type="button" onClick={() => void startProfile(state.profile)} aria-label={`Start profile ${state.profile.name}`}>
                    <Terminal size={13} />
                    Start
                  </button>
                </div>
              ) : null}
            </article>
          ))}
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

      <PortList
        entries={visibleEntries}
        selectedKey={selectedEntry ? `${selectedEntry.pid}:${selectedEntry.port}` : null}
        profileNameForEntry={(entry) => profileForEntry(entry)?.name}
        staleSignalForEntry={staleSignalForEntry}
        onSelect={(entry) => setSelectedKey(`${entry.pid}:${entry.port}`)}
        onOpen={openEntry}
        onKill={requestKillEntry}
      />

      <DetailPanel
        entry={selectedEntry}
        profile={selectedProfile}
        profileHealth={selectedProfileHealth}
        doctorReport={selectedDoctorReport}
        staleSignal={selectedStaleSignal}
        onKill={requestKillEntry}
        onOpen={openEntry}
        onCopy={(entry) => void copyEntry(entry)}
        onCopyDevContext={(entry) => void copyDevContextForEntry(entry)}
        onTerminal={(entry) => void openTerminalForEntry(entry)}
        onCleanup={(entry, mode) => void cleanupBrowserDataForEntry(entry, mode)}
        onCopyProfileCommand={(profile) => void copyProfileCommand(profile)}
        onOpenProfileTerminal={(profile) => void openTerminalForProfile(profile)}
        onCheckProfileHealth={(profile) => void checkHealthForProfile(profile)}
        onCopyDoctorAdvice={(entry, report) => void copyDoctorAdvice(entry, report)}
        onSaveProfile={(entry) => void saveProfileForEntry(entry)}
        onTrustProject={(entry) => void trustProject(entry)}
        onHideProcess={(entry) => void hideProcess(entry)}
      />

      {pendingKillEntry ? (
        <SafeActionDialog
          entry={pendingKillEntry}
          profile={profileForEntry(pendingKillEntry)}
          onCancel={() => setPendingKillEntry(null)}
          onConfirm={(entry) => void confirmKillEntry(entry)}
        />
      ) : null}

      {settingsManagerOpen ? (
        <SettingsManager
          settings={settings}
          saving={settingsActionSaving}
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
