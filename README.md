# Localhost Control

Localhost Control is a Chrome/Brave extension for finding stale local dev servers and stopping them without digging through terminals. The native host supports Windows, macOS, and Linux.

It has two pieces:

- `packages/extension`: MV3 side panel built with React, TypeScript, Vite, and `chrome.sidePanel`.
- `packages/native-host`: Node-based native messaging host that scans TCP listeners, probes HTTP, and stops killable dev processes through the host operating system.

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

Then click the Localhost Control toolbar icon. Brave opens the persistent side panel.

## Scripts

```powershell
pnpm test:run
pnpm typecheck
pnpm build
pnpm extension:package
pnpm host:install -- --browser brave --extension-id <extension-id>
pnpm host:uninstall -- --browser brave
EXTENSION_ID=<extension-id> pnpm host:install:mac
EXTENSION_ID=<extension-id> pnpm host:install:linux
pnpm host:package:mac
pnpm host:package:linux
pnpm host:verify:mac
pnpm host:verify:linux
```

Use `--browser all` to register the native host for Brave, Chrome, Chromium, and Edge under HKCU.

The macOS and Linux installers register Chrome and Brave. The default extension ID for packaged v2 artifacts is the published Chrome Web Store ID `oamllgeaemchejbebgamdakjloahgjdc`; use `EXTENSION_ID=<id>` for unpacked local development.

`pnpm host:package:mac` must run on macOS with `pkgbuild` available. `pnpm host:package:linux` creates a tarball and a `.deb` using Node and `tar`, so the Linux artifacts can be assembled on Windows, macOS, or Linux and are still verified on Ubuntu in CI.

GitHub Actions builds the native host artifacts on the target operating systems through `.github/workflows/native-host-artifacts.yml`. The workflow runs tests, typecheck, the workspace build, OS-specific packaging, and artifact validation before uploading the macOS `.pkg` and Linux `.tar.gz`/`.deb` files.

## Chrome Web Store package

Build the upload ZIP with:

```powershell
pnpm extension:package
```

The script rebuilds the extension and writes `dist\chrome-store\localhost-control-<version>-chrome-store.zip`. Upload that ZIP in the Chrome Web Store Developer Dashboard. The native host is installed separately through the Windows, macOS, or Linux installer; mention that in the Store test instructions.

Store listing notes, permission justifications, privacy answers, and reviewer instructions live in `docs\chrome-store-submission.md`.

## Safety Model

The native host marks system processes, low ports, browser processes, PID 4, and Windows executables under `C:\Windows` as protected. Protected rows stay visible but their kill controls are disabled.

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
