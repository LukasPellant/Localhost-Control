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

1. Install the uploaded Chrome Web Store build. For pre-publication review, use the exact ZIP uploaded to the store, `localhost-control-<version>-chrome-store.zip`.
2. Install the matching native host from the final GitHub Release for the same version:
   - Windows: download `localhost-control-native-host-windows-<version>.zip`, extract it, and run `install.ps1`.
   - macOS: download `localhost-control-native-host-macos-universal-<version>.pkg` and install it. The public `.pkg` should be signed/notarized before broad distribution.
   - Debian/Ubuntu: download `localhost-control-native-host_<version>_amd64.deb` or `localhost-control-native-host_<version>_arm64.deb` and install it with the system package installer.
   - Portable macOS/Linux review: use the matching `.tar.gz` and run `install.sh`.
3. Start a disposable local server:

```powershell
node -e "require('node:http').createServer((_, res) => res.end('ok')).listen(5173, '127.0.0.1')"
```

4. Open the Localhost Control side panel.
5. Verify the local listener appears with PID/resource metadata.
6. Verify the Open and Copy URL actions use `http://127.0.0.1:5173`.
7. Save a profile for the listener, trust a temporary project path, add `http://127.0.0.1:5173` as the main URL, add `http://127.0.0.1:5173/health` as the health URL, and set this start command:

```powershell
node -e "require('node:http').createServer((_, res) => res.end('ok')).listen(5173, '127.0.0.1')"
```

8. Stop the manually started disposable server, then start the saved profile from the side panel and verify the ready notification appears when the localhost health check succeeds.
9. Stop that profile, temporarily change the saved profile health URL to `http://127.0.0.1:59999/health`, start the saved profile again, and verify the failed notification appears when the localhost health check does not become ready.
10. Verify cleanup controls clear only the selected localhost origin and that Hard reload reloads matching localhost tabs.
11. Verify Stop asks for confirmation and stops the disposable local server.
12. Confirm native messaging through the browser, not only by launching the host binary directly: Chrome, Brave, and Firefox should all be able to open Localhost Control and receive a scan/version response from the installed native host.

For Firefox review builds, install the Firefox add-on package submitted to Mozilla Add-ons, or load the exact `localhost-control-<version>-firefox.zip` from the same GitHub Release in `about:debugging#/runtime/this-firefox`. Firefox native messaging uses the add-on ID `localhost-control@lukaspellant.dev`; the final native host packages are built with that ID. After loading Firefox, repeat the native messaging and disposable-server checks above.

Uninstall the native host after review if desired:

```powershell
.\uninstall.ps1
```

```bash
sudo "/Library/Application Support/Localhost Control/uninstall.sh"
sudo dpkg -r localhost-control-native-host
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
- [ ] Confirm `.github/workflows/release-native-host.yml` passed for the release tag or manual `release-native-host.yml` run.
- [ ] Confirm the final GitHub Release contains the Windows ZIP, universal macOS PKG/TAR.GZ, Linux amd64/arm64 DEB/TAR.GZ, Chrome ZIP, Firefox ZIP, and `SHA256SUMS`.
- [ ] Verify `SHA256SUMS` against the downloaded native host artifacts.
- [ ] Confirm Windows package validation, Linux install smoke, macOS install smoke, and Firefox lint are green in the release workflow logs.
- [ ] Confirm macOS signing/notarization status is recorded before broad public distribution.
- [ ] Confirm Chrome, Brave, and Firefox native messaging works with the final release extension IDs and installed native host packages on each supported operating system.
