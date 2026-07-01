# Chrome Web Store Submission Notes

Use this file as the source of truth when preparing the Chrome Web Store listing, privacy answers, and reviewer notes for Localhost Control.

## Single Purpose

Localhost Control helps developers inspect local TCP listeners created by development servers, manage saved local project profiles, clean localhost browser state, and stop stale local processes from a Chromium side panel.

## Suggested Store Summary

Find, check, clean, and stop localhost development servers from a clean Chrome side panel.

## Suggested Description

Localhost Control is a developer utility for local web development on Windows, macOS, and Linux. It scans localhost TCP listeners, shows useful process metadata such as PID, command, CPU, memory, threads, handles where available, and uptime, and lets you open, copy, health-check, clean, or stop known local development servers.

After installing the extension, install the Localhost Control native host for your operating system from GitHub Releases:
https://github.com/LukasPellant/Localhost-Control/releases

Windows users can download the Windows native host ZIP, extract it, and run `install.ps1`. macOS users can use the `.pkg` installer, and Debian/Ubuntu users can use the `.deb` package.

The extension communicates only with its native messaging host installed on the same computer. It does not run a local HTTP server, does not collect telemetry, and does not send browsing data or process data to any external service.

## Permission Justification

- `nativeMessaging`: required to ask the locally installed native host for process and port metadata, and to stop selected local processes.
- `sidePanel`: required because the product UI is a persistent Chrome side panel.
- `storage`: required to save local user preferences such as filters, trusted project paths, hidden ports, project profiles, workspaces, and refresh interval.
- `browsingData`: required to clear cookies, local storage, IndexedDB, cache storage, and service workers only for the selected localhost origin when the user explicitly clicks the cleanup action.
- `notifications`: required to show a local browser notification when a user-started saved project profile becomes healthy or fails its localhost health check.
- Optional localhost host permissions: requested only for user-configured localhost health-check URLs and hard-reload tab matching, so the extension can fetch local health endpoints such as `http://127.0.0.1:5173/health` and reload matching localhost tabs.

## Privacy Practices

- Single purpose: local development server inspection and control.
- Data collection: none.
- Data sharing: none.
- Remote code: none. All extension JavaScript/CSS/assets are packaged in the extension ZIP.
- Network behavior: HTTP probes and saved profile health checks are sent only to local listener URLs such as `127.0.0.1`, `0.0.0.0` via loopback, `::1`, `localhost`, or `*.localhost`.
- Native host data: process names, command lines, project paths, ports, and resource counters are displayed locally in the extension UI and are not transmitted externally by the extension.
- Browser data access: cleanup actions target only the selected localhost origin and run only after the user clicks the cleanup control.

## Reviewer Instructions

1. Install the Chrome extension ZIP built by `pnpm extension:package:chrome`.
2. Copy the extension ID from `chrome://extensions`.
3. Install the native host for Chrome:

```powershell
pnpm host:install -- --browser chrome --extension-id <extension-id>
```

On macOS or Linux, use:

```bash
EXTENSION_ID=<extension-id> pnpm host:install:mac
EXTENSION_ID=<extension-id> pnpm host:install:linux
```

For Firefox review builds, package with `pnpm extension:package:firefox`, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select the packaged ZIP or its extracted `manifest.json`. Install the native host with `FIREFOX_EXTENSION_ID=localhost-control@lukaspellant.dev` on macOS/Linux, or on Windows use:

```powershell
pnpm host:install -- --browser firefox --firefox-extension-id localhost-control@lukaspellant.dev
```

4. Start a disposable local server:

```powershell
node -e "require('node:http').createServer((_, res) => res.end('ok')).listen(5173, '127.0.0.1')"
```

5. Open the Localhost Control side panel.
6. Verify the local listener appears with PID/resource metadata.
7. Verify the Open and Copy URL actions use `http://127.0.0.1:5173`.
8. Save a profile for the listener, trust a temporary project path, add `http://127.0.0.1:5173` as the main URL, add `http://127.0.0.1:5173/health` as the health URL, and set this start command:

```powershell
node -e "require('node:http').createServer((_, res) => res.end('ok')).listen(5173, '127.0.0.1')"
```

9. Stop the manually started disposable server, then start the saved profile from the side panel and verify the ready notification appears when the localhost health check succeeds.
10. Stop that profile, temporarily change the saved profile health URL to `http://127.0.0.1:59999/health`, start the saved profile again, and verify the failed notification appears when the localhost health check does not become ready.
11. Verify cleanup controls clear only the selected localhost origin and that Hard reload reloads matching localhost tabs.
12. Verify Stop asks for confirmation and stops the disposable local server.
13. Uninstall the native host after review if desired:

```powershell
pnpm host:uninstall -- --browser chrome
```

## Pre-Upload Checklist

- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm test:run`.
- [ ] Run `pnpm build`.
- [ ] Run `pnpm extension:package:chrome`.
- [ ] Run `pnpm extension:package:firefox`.
- [ ] Run `pnpm extension:verify`.
- [ ] Run `pnpm extension:lint:firefox` against the packaged Firefox ZIP.
- [ ] Confirm any Firefox lint warnings are only the reviewed React runtime `UNSAFE_VAR_ASSIGNMENT` warnings in bundled `sidepanel.js`; app source must not use direct `innerHTML`.
- [ ] Confirm the production bundle does not contain demo project names or paths.
- [ ] Confirm the native host has been tested with the final extension ID.
