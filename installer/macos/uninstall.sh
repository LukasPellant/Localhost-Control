#!/usr/bin/env bash
set -euo pipefail

HOST_NAME="com.localhost_control.host"
rm -f "${HOME}/Library/Application Support/Google/Chrome/NativeMessagingHosts/${HOST_NAME}.json"
rm -f "${HOME}/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/${HOST_NAME}.json"
rm -f "${HOME}/Library/Application Support/Mozilla/NativeMessagingHosts/${HOST_NAME}.json"
rm -rf "${HOME}/Library/Application Support/Localhost Control"

echo "Removed Localhost Control native host."
