# Chrome Web Store Submission Notes

Use this file as the source of truth when preparing the Chrome Web Store listing, privacy answers, and reviewer notes for Localhost Control.

## Single Purpose

Localhost Control helps developers inspect local TCP listeners created by development servers and stop stale local processes from a Chromium side panel.

## Suggested Store Summary

Find and stop stale localhost development servers from a clean Chrome side panel.

## Suggested Description

Localhost Control is a developer utility for local web development on Windows, macOS, and Linux. It scans localhost TCP listeners, shows useful process metadata such as PID, command, CPU, memory, threads, handles where available, and uptime, and lets you open, copy, or stop known local development servers.

After installing the extension, install the Localhost Control native host for your operating system from GitHub Releases:
https://github.com/LukasPellant/Localhost-Control/releases

The extension communicates only with its native messaging host installed on the same computer. It does not run a local HTTP server, does not collect telemetry, and does not send browsing data or process data to any external service.

## Permission Justification

- `nativeMessaging`: required to ask the locally installed native host for process and port metadata, and to stop selected local processes.
- `sidePanel`: required because the product UI is a persistent Chrome side panel.
- `storage`: required to save local user preferences such as filters, trusted project paths, hidden ports, and refresh interval.

## Privacy Practices

- Single purpose: local development server inspection and control.
- Data collection: none.
- Data sharing: none.
- Remote code: none. All extension JavaScript/CSS/assets are packaged in the extension ZIP.
- Network behavior: HTTP probes are sent only to local listener URLs such as `127.0.0.1`, `0.0.0.0` via loopback, `::1`, or wildcard listeners normalized to loopback.
- Native host data: process names, command lines, project paths, ports, and resource counters are displayed locally in the extension UI and are not transmitted externally by the extension.

## Reviewer Instructions

1. Install the extension ZIP built by `pnpm extension:package`.
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

For Firefox review builds, package with `pnpm extension:package:firefox` and install the native host with `FIREFOX_EXTENSION_ID=localhost-control@lukaspellant.dev` if testing a signed build with that add-on ID.

4. Start a disposable local server:

```powershell
node -e "require('node:http').createServer((_, res) => res.end('ok')).listen(5173, '127.0.0.1')"
```

5. Open the Localhost Control side panel.
6. Verify the local listener appears with PID/resource metadata.
7. Verify the Open and Copy URL actions use `http://127.0.0.1:5173`.
8. Verify Kill stops the disposable local server.
9. Uninstall the native host after review if desired:

```powershell
pnpm host:uninstall -- --browser chrome
```

## Pre-Upload Checklist

- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm test:run`.
- [ ] Run `pnpm build`.
- [ ] Run `pnpm extension:package`.
- [ ] Confirm `packages/extension/dist/manifest.json` uses Manifest V3.
- [ ] Confirm `packages/extension/dist/manifest.json` permissions are only `nativeMessaging`, `sidePanel`, and `storage`.
- [ ] Confirm the ZIP contains `manifest.json` at the archive root.
- [ ] Confirm the production bundle does not contain demo project names or paths.
- [ ] Confirm the native host has been tested with the final extension ID.
