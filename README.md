# Localhost Control

Localhost Control is a Chrome, Brave, and Firefox extension for finding stale local dev servers, checking project health, cleaning localhost browser state, and stopping local process trees without digging through terminals. The native host supports Windows, macOS, and Linux.

It has two pieces:

- `packages/extension`: MV3 browser extension built with React, TypeScript, and Vite. Chrome/Brave use `sidePanel`; Firefox uses the same UI through `sidebar_action`.
- `packages/native-host-rust`: Rust native messaging host for Windows, macOS, and Linux. It scans TCP listeners, probes HTTP, and stops killable dev processes without requiring Node.js on the user's machine.
- `scripts`: packaging, checksum, and native messaging manifest tooling for the Rust host artifacts.

The extension talks only to the native host through browser native messaging. It does not expose a local HTTP server and does not send telemetry.

## Features

- Inspect localhost TCP listeners with PID, command, project path, HTTP status, uptime, and resource metadata where the operating system provides it.
- Save project profiles with expected ports, local URLs, health checks, notes, and launch commands so the side panel acts as a local command center instead of a raw port list.
- Stop local dev processes safely by default with terminate-tree actions, with explicit force-tree controls for stubborn processes.
- Spot possible stale or ghost processes and copy actionable cleanup advice.
- Open local URLs in desktop, tablet, or phone preview windows, hard-reload matching localhost tabs, and clear selected localhost origin storage on demand.
- Receive browser notifications when a started profile becomes healthy or fails its health check.

## Downloads

Install the browser extension from the Chrome Web Store:

```text
https://chromewebstore.google.com/detail/localhost-control/oamllgeaemchejbebgamdakjloahgjdc
```

Then install the native host for your operating system from GitHub Releases:

```text
https://github.com/LukasPellant/Localhost-Control/releases
```

Use the Windows `.zip`, the macOS `.pkg` when available, the Linux `.deb` on Debian/Ubuntu systems, or the `.tar.gz` packages for portable installs. The native host packages are built for the published Chrome Web Store extension ID `oamllgeaemchejbebgamdakjloahgjdc`.

Firefox builds are packaged separately as `dist\firefox-addons\localhost-control-<version>-firefox.zip` and use the add-on ID `localhost-control@lukaspellant.dev` for native messaging.

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

Install the native host for Brave on Windows:

```powershell
pnpm host:install -- --browser brave --extension-id <extension-id>
```

Install the native host for Chrome and Brave on macOS:

```bash
EXTENSION_ID=<extension-id> pnpm host:install:mac
```

Install the native host for Chrome and Brave on Linux:

```bash
EXTENSION_ID=<extension-id> pnpm host:install:linux
```

Then click the Localhost Control toolbar icon. Chrome/Brave open the persistent side panel; Firefox opens the extension sidebar.

## Scripts

```powershell
pnpm test:run
pnpm host:test:windows-rust
pnpm smoke:native-host
pnpm typecheck
pnpm build
pnpm extension:package
pnpm extension:package:chrome
pnpm extension:package:firefox
pnpm host:install -- --browser brave --extension-id <extension-id>
pnpm host:uninstall -- --browser brave
EXTENSION_ID=<extension-id> pnpm host:install:mac
EXTENSION_ID=<extension-id> pnpm host:install:linux
pnpm host:package:windows
pnpm host:package:mac
pnpm host:package:mac:tarball
pnpm host:package:linux
pnpm host:package:release-local
pnpm host:verify:windows
pnpm host:verify:mac
pnpm host:verify:mac:tarball
pnpm host:verify:linux
pnpm host:verify:release-local
```

Use `--browser all` to register the native host for Brave, Chrome, Chromium, Edge, and Firefox under HKCU. The Windows installer builds and registers the Rust native host binary at `installer\windows\out\localhost-control-host.exe`; the installed Windows host does not require Node.js. Release ZIPs include a prebuilt `out\localhost-control-host.exe`, so end users do not need Rust.

The macOS and Linux installers register Chrome, Brave, and Firefox. The macOS and Linux packages install the Rust native host binary directly, so end users do not need Node.js. The default Chromium extension ID for packaged artifacts is the published Chrome Web Store ID `oamllgeaemchejbebgamdakjloahgjdc`; Firefox uses `localhost-control@lukaspellant.dev`. Use `EXTENSION_ID=<id>` and `FIREFOX_EXTENSION_ID=<id>` for unpacked local development.

`pnpm host:package:mac:tarball` creates a self-contained macOS `.tar.gz` with the Rust macOS native host; run it on macOS or pass `--host-binary` to `scripts/package-native-host.mjs` with a macOS-built `localhost-control-host` binary. `pnpm host:package:mac` also creates a native `.pkg` and must run on macOS with `pkgbuild` available. `pnpm host:package:linux` builds the Rust Linux native host and creates a tarball plus `.deb`; run it on Linux or pass `--host-binary` with a Linux-built `localhost-control-host` binary.

For local native host artifacts, build on the target operating system or pass `--host-binary` to `scripts/package-native-host.mjs` with a binary built for that target. `pnpm host:package:release-local` is intended for an environment where the required target binaries are available; otherwise use GitHub Actions to produce the Windows, macOS, and Linux release assets on their native runners.

`pnpm test:run` runs deterministic unit and packaging tests. `pnpm smoke:native-host` runs the Rust native-host test suite.

GitHub Actions builds the native host artifacts on the target operating systems through `.github/workflows/native-host-artifacts.yml` and publishes release assets through `.github/workflows/release-native-host.yml`. The workflows run deterministic tests, Rust native-host tests, typecheck, the workspace build, OS-specific packaging, and artifact validation before uploading the Windows `.zip`, macOS `.pkg`/`.tar.gz`, and Linux `.tar.gz`/`.deb` files.

## Chrome Web Store package

Build the upload ZIP with:

```powershell
pnpm extension:package:chrome
```

The script rebuilds the extension, writes `dist\chrome-store\localhost-control-<version>-chrome-store.zip`, and validates the finished archive before reporting success. Upload that ZIP in the Chrome Web Store Developer Dashboard. The native host is installed separately through the Windows, macOS, or Linux installer; mention that in the Store test instructions.

Build the Firefox ZIP with:

```powershell
pnpm extension:package:firefox
```

It writes `dist\firefox-addons\localhost-control-<version>-firefox.zip` and validates the finished archive before reporting success.

To re-check existing Chrome and Firefox ZIPs without rebuilding, run:

```powershell
pnpm extension:verify
```

Store listing notes, permission justifications, privacy answers, and reviewer instructions live in `docs\chrome-store-submission.md`.

## Safety Model

The native host marks system processes, low ports, browser processes, PID 4, and Windows executables under `C:\Windows` as protected. Protected rows stay visible but their stop controls are disabled.

For normal dev servers, the side panel defaults to a safer process-tree terminate action and keeps force-tree stops as an explicit fallback. Unknown low-confidence processes remain stoppable only after a browser confirmation prompt.

Browser cleanup and hard reload actions are limited to the selected localhost origin. Project health notifications are local browser notifications triggered only after the user starts a saved profile with a localhost health check.

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
- [Firefox native messaging](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging)
- [Firefox sidebar_action](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/sidebar_action)
