#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob

artifacts=(dist/native-host/localhost-control-native-host-macos-universal-*.pkg)
if [ "${#artifacts[@]}" -ne 1 ]; then
  printf 'Expected exactly one macOS pkg, found %s\n' "${#artifacts[@]}" >&2
  exit 1
fi

cleanup() {
  if [ -x "/Library/Application Support/Localhost Control/uninstall.sh" ]; then
    sudo "/Library/Application Support/Localhost Control/uninstall.sh" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

sudo installer -pkg "${artifacts[0]}" -target /
test -x "/Library/Application Support/Localhost Control/localhost-control-host"
test -f "/Library/Google/Chrome/NativeMessagingHosts/com.localhost_control.host.json"
test -f "/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.localhost_control.host.json"
test -f "/Library/Application Support/Mozilla/NativeMessagingHosts/com.localhost_control.host.json"

node <<'NODE'
const { spawnSync } = require("node:child_process");
const pkg = require("./package.json");
const hostPath = "/Library/Application Support/Localhost Control/localhost-control-host";
const body = Buffer.from(JSON.stringify({ id: "installed-smoke", method: "version" }));
const frame = Buffer.alloc(4 + body.length);
frame.writeUInt32LE(body.length, 0);
body.copy(frame, 4);
const result = spawnSync(hostPath, [], { input: frame, timeout: 5000 });
if (result.status !== 0) throw new Error(result.stderr?.toString() || `host exited with ${result.status}`);
const length = result.stdout.readUInt32LE(0);
const response = JSON.parse(result.stdout.subarray(4, 4 + length).toString("utf8"));
if (response.id !== "installed-smoke" || response.result?.version !== pkg.version) throw new Error("invalid native host version response");
NODE

sudo "/Library/Application Support/Localhost Control/uninstall.sh"
trap - EXIT
test ! -e "/Library/Application Support/Localhost Control/localhost-control-host"
test ! -e "/Library/Google/Chrome/NativeMessagingHosts/com.localhost_control.host.json"
test ! -e "/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.localhost_control.host.json"
test ! -e "/Library/Application Support/Mozilla/NativeMessagingHosts/com.localhost_control.host.json"
