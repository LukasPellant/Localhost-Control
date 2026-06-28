import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, Settings2, ShieldAlert } from "lucide-react";
import { withAppScope, type KillParams, type PortEntry, type ScanResult } from "@localhost-control/shared";
import { DetailPanel } from "./components/DetailPanel";
import { IconButton } from "./components/IconButton";
import { PortList } from "./components/PortList";
import { type HostClient } from "./lib/hostClient";
import { filterEntries, filterLabel, type FilterId } from "./lib/portFilters";
import { defaultSettings, loadSettings, saveSettings, type Settings } from "./lib/settings";
import "./styles.css";

const filters: FilterId[] = ["web", "custom", "all", "node", "python", "unknown", "protected"];
const themeQuery = "(prefers-color-scheme: dark)";

type AppProps = {
  client: HostClient;
};

const isLowConfidenceUnknown = (entry: PortEntry): boolean => entry.detectedKind === "unknown" && entry.confidence === "low";
const resolveTheme = (themeMode: Settings["themeMode"]): "light" | "dark" => {
  if (themeMode === "dark") return "dark";
  if (themeMode === "light") return "light";
  return typeof window !== "undefined" && window.matchMedia?.(themeQuery).matches ? "dark" : "light";
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
  const killableCount = entries.filter((entry) => entry.killable).length;
  const protectedCount = entries.length - killableCount;

  const patchSettings = async (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    await saveSettings(next);
  };

  const killEntry = async (entry: PortEntry) => {
    if (!entry.killable) return;
    if (isLowConfidenceUnknown(entry) && !window.confirm(`Kill unknown process ${entry.processName} on port ${entry.port}?`)) {
      return;
    }

    setBusy(true);
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
    if (typeof chrome !== "undefined" && chrome.tabs?.create) {
      void chrome.tabs.create({ url });
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const copyEntry = async (entry: PortEntry) => {
    const url = entry.url ?? `http://127.0.0.1:${entry.port}`;
    await navigator.clipboard.writeText(url);
    setMessage(`Copied ${url}`);
  };

  const openTerminalForEntry = async (entry: PortEntry) => {
    const result = await client.openTerminal({
      ...(entry.projectHint ? { projectHint: entry.projectHint } : {}),
      ...(entry.commandLine ? { commandLine: entry.commandLine } : {})
    });
    setMessage(result.message);
  };

  const trustProject = async (entry: PortEntry) => {
    if (!entry.projectHint || settings.trustedProjectPaths.includes(entry.projectHint)) return;
    await patchSettings({ trustedProjectPaths: [...settings.trustedProjectPaths, entry.projectHint] });
    setFilter("web");
    setMessage(`Trusted ${entry.projectHint}`);
  };

  const hideProcess = async (entry: PortEntry) => {
    const processName = entry.processName.toLowerCase();
    if (settings.blockedProcessNames.map((name) => name.toLowerCase()).includes(processName)) return;
    await patchSettings({ blockedProcessNames: [...settings.blockedProcessNames, processName] });
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
          <code>pnpm host:install -- --browser brave --extension-id &lt;id&gt;</code>
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

      <PortList
        entries={visibleEntries}
        selectedPort={selectedEntry?.port}
        onSelect={(entry) => setSelectedKey(`${entry.pid}:${entry.port}`)}
        onOpen={openEntry}
        onKill={(entry) => void killEntry(entry)}
      />

      <DetailPanel
        entry={selectedEntry}
        onKill={(entry) => void killEntry(entry)}
        onOpen={openEntry}
        onCopy={(entry) => void copyEntry(entry)}
        onTerminal={(entry) => void openTerminalForEntry(entry)}
        onTrustProject={(entry) => void trustProject(entry)}
        onHideProcess={(entry) => void hideProcess(entry)}
      />

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
