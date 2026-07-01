#!/usr/bin/env bash
set -euo pipefail

HOST_NAME="com.localhost_control.host"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SCOPE="${SCOPE:-}"
if [ -z "${SCOPE}" ] && [ "${SCRIPT_DIR}" = "/Library/Application Support/Localhost Control" ]; then
  SCOPE="system"
elif [ -z "${SCOPE}" ]; then
  SCOPE="user"
fi

if [ "${SCOPE}" = "system" ]; then
  rm -f "/Library/Google/Chrome/NativeMessagingHosts/${HOST_NAME}.json"
  rm -f "/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/${HOST_NAME}.json"
  rm -f "/Library/Application Support/Mozilla/NativeMessagingHosts/${HOST_NAME}.json"
  rm -rf "/Library/Application Support/Localhost Control"
else
  rm -f "${HOME}/Library/Application Support/Google/Chrome/NativeMessagingHosts/${HOST_NAME}.json"
  rm -f "${HOME}/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/${HOST_NAME}.json"
  rm -f "${HOME}/Library/Application Support/Mozilla/NativeMessagingHosts/${HOST_NAME}.json"
  rm -rf "${HOME}/Library/Application Support/Localhost Control"
fi

echo "Removed Localhost Control native host."
