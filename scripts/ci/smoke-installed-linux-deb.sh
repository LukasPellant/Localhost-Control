#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob

arch="${1:?Usage: smoke-installed-linux-deb.sh <amd64|arm64>}"
artifacts=(dist/native-host/localhost-control-native-host_*_"${arch}".deb)
if [ "${#artifacts[@]}" -ne 1 ]; then
  printf 'Expected exactly one Linux deb for %s, found %s\n' "${arch}" "${#artifacts[@]}" >&2
  exit 1
fi

cleanup() {
  sudo dpkg -r localhost-control-native-host >/dev/null 2>&1 || true
}
trap cleanup EXIT

smoke_browser_native() {
  local browser="${1:?browser is required}"
  local required_args=()
  if [ "${BROWSER_NATIVE_SMOKE_REQUIRED:-false}" = "true" ]; then
    required_args+=(--required)
  fi

  pnpm smoke:browser-native -- --browser "${browser}" --headless "${required_args[@]}" --host-path /usr/lib/localhost-control/localhost-control-host
}

sudo dpkg -i "${artifacts[0]}"
test -x /usr/lib/localhost-control/localhost-control-host
test -f /etc/opt/chrome/native-messaging-hosts/com.localhost_control.host.json
test -f /etc/brave/native-messaging-hosts/com.localhost_control.host.json
test -f /usr/lib/mozilla/native-messaging-hosts/com.localhost_control.host.json

node <<'NODE'
const { spawnSync } = require("node:child_process");
const pkg = require("./package.json");
const body = Buffer.from(JSON.stringify({ id: "installed-smoke", method: "version" }));
const frame = Buffer.alloc(4 + body.length);
frame.writeUInt32LE(body.length, 0);
body.copy(frame, 4);
const result = spawnSync("/usr/lib/localhost-control/localhost-control-host", [], { input: frame, timeout: 5000 });
if (result.status !== 0) throw new Error(result.stderr?.toString() || `host exited with ${result.status}`);
const length = result.stdout.readUInt32LE(0);
const response = JSON.parse(result.stdout.subarray(4, 4 + length).toString("utf8"));
if (response.id !== "installed-smoke" || response.result?.version !== pkg.version) throw new Error("invalid native host version response");
NODE

for browser in ${BROWSER_NATIVE_SMOKE_BROWSERS:-chrome firefox}; do
  smoke_browser_native "${browser}"
done

sudo dpkg -r localhost-control-native-host
trap - EXIT
test ! -e /usr/lib/localhost-control/localhost-control-host
test ! -e /etc/opt/chrome/native-messaging-hosts/com.localhost_control.host.json
test ! -e /etc/brave/native-messaging-hosts/com.localhost_control.host.json
test ! -e /usr/lib/mozilla/native-messaging-hosts/com.localhost_control.host.json
