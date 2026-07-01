# LocalhostControl

## What this codebase does

Localhost Control is a browser extension plus Rust native messaging host for local developers. The extension is a Vite/React/TypeScript MV3 UI for Chrome, Brave, and Firefox; the host is a Rust stdio native messaging binary for Windows, macOS, and Linux. It scans localhost TCP listeners, probes local HTTP health, launches saved project commands, clears localhost browser data, and stops process trees.

## Auth shape

There is no user account or remote auth service. The main trust boundary is browser native messaging:

- `com.localhost_control.host` is the only native host name the extension should connect to.
- Chromium native host manifests must use `allowed_origins` with explicit `chrome-extension://<id>/` origins.
- Firefox native host manifests must use `allowed_extensions` with the explicit Gecko ID `localhost-control@lukaspellant.dev`.
- Process start/stop operations are local privileged actions guarded by project trust, protected process rules, and browser confirmation prompts.

## Threat model

Highest impact is a malicious or compromised extension origin gaining native host access and starting/stopping arbitrary local processes. Next is an unsafe command/profile flow that launches a saved command outside a trusted project path or kills protected browser/system processes. Browser cleanup must remain scoped to localhost origins so the extension cannot clear unrelated browsing data.

## Project-specific patterns to flag

- Native messaging manifests that omit `allowed_origins` or `allowed_extensions`, include wildcard origins, or use the wrong extension ID.
- New host protocol methods in `packages/native-host-rust` or `packages/extension/src/lib/hostClient.ts` that execute filesystem, process, or network actions without project/path validation.
- Start-command handling that bypasses trusted project checks, ignores port reservation, or rewrites arbitrary commands instead of known dev-server patterns.
- Kill/process-tree logic that weakens protected process checks for browsers, PID 4, system paths, or low ports.
- Browser cleanup code that expands beyond localhost URL patterns or selected localhost origins.

## Known false-positives

- `test/` and `packages/extension/src/*.test.ts*` include fake manifests, fake commands, and deliberately invalid package fixtures.
- `scripts/validate-native-host-package.mjs` constructs minimal archives and ELF headers for package validation tests.
- `packages/extension/dist/`, `dist/`, `target/`, and `installer/windows/out/` are generated artifacts.
- `sidepanel.js` in packaged extension output may contain React runtime `innerHTML` patterns; source under `packages/extension/src` should not.
- Localhost URL permissions and probes are intended for loopback development servers only.
