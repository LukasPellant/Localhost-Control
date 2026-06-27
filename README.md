# Localhost Control

Localhost Control is a Windows-first Brave/Chromium extension for finding stale local dev servers and killing them without digging through terminals.

It has two pieces:

- `packages/extension`: MV3 side panel built with React, TypeScript, Vite, and `chrome.sidePanel`.
- `packages/native-host`: Node-based native messaging host that scans TCP listeners, probes HTTP, and runs `taskkill /PID <pid> /T /F` for killable dev processes.

The extension talks only to the native host through Chromium native messaging. It does not expose a local HTTP server and does not send telemetry.

## Setup

```powershell
pnpm install
pnpm build
```

Load the extension unpacked:

1. Open `brave://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked**.
4. Select `D:\DevelopmentD\LocalhostControl\packages\extension\dist`.
5. Copy the generated extension ID.

Install the native host for Brave:

```powershell
pnpm host:install -- --browser brave --extension-id <extension-id>
```

Then click the Localhost Control toolbar icon. Brave opens the persistent side panel.

## Scripts

```powershell
pnpm test:run
pnpm typecheck
pnpm build
pnpm host:install -- --browser brave --extension-id <extension-id>
pnpm host:uninstall -- --browser brave
```

Use `--browser all` to register the native host for Brave, Chrome, Chromium, and Edge under HKCU.

## Safety Model

The native host marks Windows system processes, low ports, browser processes, PID 4, and executables under `C:\Windows` as protected. Protected rows stay visible but their kill controls are disabled.

For normal dev servers, the side panel offers one-click force-kill. Unknown low-confidence processes remain killable only after a browser confirmation prompt.

## Development UI

For visual work without installing the extension, run:

```powershell
pnpm --filter @localhost-control/extension dev
```

Open the Vite URL with `?mock=1`, for example:

```text
http://127.0.0.1:5173/sidepanel.html?mock=1
```

## References

- [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
