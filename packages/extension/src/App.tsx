import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, RefreshCw, Search, Settings2, ShieldAlert } from "lucide-react";
import { withAppScope, type KillParams, type PortEntry, type ScanResult } from "@localhost-control/shared";
import { DetailPanel } from "./components/DetailPanel";
import { IconButton } from "./components/IconButton";
import { PortList } from "./components/PortList";
import { SafeActionDialog } from "./components/SafeActionDialog";
import { clearBrowserDataForUrl } from "./lib/browserCleanup";
import { getExtensionApi } from "./lib/extensionApi";
import { type HostClient } from "./lib/hostClient";
import { filterEntries, filterLabel, type FilterId } from "./lib/portFilters";
import { deriveProfileStates, matchProfileForEntry, type ProjectProfile } from "./lib/projectProfiles";
import { defaultSettings, loadSettings, saveSettings, type Settings } from "./lib/settings";
import "./styles.css";

const filters: FilterId[] = ["web", "custom", "all", "node", "python", "unknown", "protected"];
const themeQuery = "(prefers-color-scheme: dark)";
const nativeHostReleasesUrl = "https://github.com/LukasPellant/Localhost-Control/releases";

type AppProps = {
  client: HostClient;
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
  const openedDownloadForError = useRef(false);

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
  const profileStates = useMemo(() => deriveProfileStates(settings.projectProfiles, entries), [entries, settings.projectProfiles]);
  const profileForEntry = useCallback(
    (entry: PortEntry): ProjectProfile | undefined => matchProfileForEntry(entry, settings.projectProfiles)?.profile,
    [settings.projectProfiles]
  );
  const selectedProfile = selectedEntry ? profileForEntry(selectedEntry) : undefined;
  const killableCount = entries.filter((entry) => entry.killable).length;
  const protectedCount = entries.length - killableCount;

  const patchSettings = async (patch: Partial<Settings>): Promise<boolean> => {
    const previous = settings;
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      await saveSettings(next);
      return true;
    } catch (error) {
      setSettings(previous);
      setMessage(error instanceof Error ? error.message : String(error));
      return false;
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

  const cleanupBrowserDataForEntry = async (entry: PortEntry) => {
    const url = entry.url ?? `http://127.0.0.1:${entry.port}`;
    try {
      const result = await clearBrowserDataForUrl(url);
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
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
          <p>{message || "Ready to scan local development ports"}</p>
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

      {profileStates.length ? (
        <section className="profile-strip" aria-label="Project profiles">
          {profileStates.map((state) => (
            <button
              className={`profile-chip ${state.status}`}
              key={state.profile.id}
              type="button"
              onClick={() => {
                if (state.entry) setSelectedKey(`${state.entry.pid}:${state.entry.port}`);
                else if (state.profile.mainUrl) openExternalUrl(state.profile.mainUrl);
              }}
            >
              <span className="profile-name">{state.profile.name}</span>
              <span className="profile-status">{state.status}</span>
              <span className="profile-health">{state.healthLabel}</span>
            </button>
          ))}
        </section>
      ) : null}

      <PortList
        entries={visibleEntries}
        selectedKey={selectedEntry ? `${selectedEntry.pid}:${selectedEntry.port}` : null}
        profileNameForEntry={(entry) => profileForEntry(entry)?.name}
        onSelect={(entry) => setSelectedKey(`${entry.pid}:${entry.port}`)}
        onOpen={openEntry}
        onKill={requestKillEntry}
      />

      <DetailPanel
        entry={selectedEntry}
        profile={selectedProfile}
        onKill={requestKillEntry}
        onOpen={openEntry}
        onCopy={(entry) => void copyEntry(entry)}
        onTerminal={(entry) => void openTerminalForEntry(entry)}
        onCleanup={(entry) => void cleanupBrowserDataForEntry(entry)}
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
      </footer>
    </main>
  );
};
