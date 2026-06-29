#!/usr/bin/env bash
set -euo pipefail

EXTENSION_ID="${EXTENSION_ID:-oamllgeaemchejbebgamdakjloahgjdc}"
HOST_NAME="com.localhost_control.host"
ROOT="${HOME}/Library/Application Support/Localhost Control"
HOST_SOURCE="${1:-target/release/localhost-control-host}"
HOST_TARGET="${ROOT}/localhost-control-host"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

mkdir -p "${ROOT}"
if [ -d "${SCRIPT_DIR}/app" ]; then
  rm -rf "${ROOT}/app"
  cp -R "${SCRIPT_DIR}/app" "${ROOT}/app"
  cp "${SCRIPT_DIR}/localhost-control-host" "${HOST_TARGET}"
elif [ -f "${SCRIPT_DIR}/localhost-control-host" ]; then
  rm -rf "${ROOT}/app"
  cp "${SCRIPT_DIR}/localhost-control-host" "${HOST_TARGET}"
else
  cp "${HOST_SOURCE}" "${HOST_TARGET}"
fi
chmod +x "${HOST_TARGET}"

write_manifest() {
  local target_dir="$1"
  mkdir -p "${target_dir}"
  cat > "${target_dir}/${HOST_NAME}.json" <<JSON
{
  "name": "${HOST_NAME}",
  "description": "Localhost Control native messaging host",
  "path": "${HOST_TARGET}",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://${EXTENSION_ID}/"]
}
JSON
}

write_manifest "${HOME}/Library/Application Support/Google/Chrome/NativeMessagingHosts"
write_manifest "${HOME}/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"

echo "Installed Localhost Control native host for Chrome and Brave."
