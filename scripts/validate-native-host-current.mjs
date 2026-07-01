#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
};

const arch = process.arch === "arm64" ? "arm64" : "amd64";
const targets =
  process.platform === "win32"
    ? [{ platform: "win32", format: "zip" }]
    : process.platform === "darwin"
      ? [
          { platform: "darwin", format: "tarball" },
          { platform: "darwin", format: "pkg" }
        ]
      : process.platform === "linux"
        ? [
            { platform: "linux", format: "tarball", arch },
            { platform: "linux", format: "deb", arch }
          ]
        : [];

if (targets.length === 0) {
  throw new Error(`Unsupported native host validation platform: ${process.platform}`);
}

try {
  for (const target of targets) {
    run(process.execPath, [
      "scripts/validate-native-host-package.mjs",
      `--platform=${target.platform}`,
      `--format=${target.format}`,
      ...(target.arch ? [`--arch=${target.arch}`] : [])
    ]);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
