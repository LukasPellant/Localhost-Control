#!/usr/bin/env bash
set -euo pipefail

HOST_NAME="com.localhost_control.host"
rm -f "${HOME}/.config/google-chrome/NativeMessagingHosts/${HOST_NAME}.json"
rm -f "${HOME}/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts/${HOST_NAME}.json"
rm -f "${HOME}/.mozilla/native-messaging-hosts/${HOST_NAME}.json"
rm -rf "${HOME}/.local/lib/localhost-control"

echo "Removed Localhost Control native host."
