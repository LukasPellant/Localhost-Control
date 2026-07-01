import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const writeUInt16 = (value: number) => {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
};

const writeUInt32 = (value: number) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
};

const writeZip = (output: string, entries: Record<string, string | Buffer>) => {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const [name, value] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name);
    const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const localHeader = Buffer.concat([
      writeUInt32(0x04034b50),
      writeUInt16(20),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt32(0),
      writeUInt32(data.length),
      writeUInt32(data.length),
      writeUInt16(nameBuffer.length),
      writeUInt16(0),
      nameBuffer
    ]);
    localParts.push(localHeader, data);
    centralParts.push(
      Buffer.concat([
        writeUInt32(0x02014b50),
        writeUInt16(20),
        writeUInt16(20),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt32(0),
        writeUInt32(data.length),
        writeUInt32(data.length),
        writeUInt16(nameBuffer.length),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt32(0),
        writeUInt32(offset),
        nameBuffer
      ])
    );
    offset += localHeader.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.concat([
    writeUInt32(0x06054b50),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(centralParts.length),
    writeUInt16(centralParts.length),
    writeUInt32(centralDirectory.length),
    writeUInt32(offset),
    writeUInt16(0)
  ]);

  writeFileSync(output, Buffer.concat([...localParts, centralDirectory, endRecord]));
};

const writeFakeNpx = (binDir: string, output: string) => {
  mkdirSync(binDir, { recursive: true });
  if (process.platform === "win32") {
    const lines = output.split(/\r?\n/).map((line) => `echo ${line}`);
    writeFileSync(path.join(binDir, "npx.cmd"), `@echo off\r\n${lines.join("\r\n")}\r\nexit /b 0\r\n`);
    return;
  }
  const script = path.join(binDir, "npx");
  writeFileSync(script, `#!/usr/bin/env sh\nprintf '%s\\n' '${output.replace(/'/g, "'\\''")}'\nexit 0\n`);
  chmodSync(script, 0o755);
};

const runFirefoxLint = (webExtOutput: string) => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "localhost-control-firefox-lint-test-"));
  const artifact = path.join(tempRoot, "firefox.zip");
  const binDir = path.join(tempRoot, "bin");
  writeZip(artifact, {
    "manifest.json": "{}\n",
    "sidepanel.js": "console.log('test');\n"
  });
  writeFakeNpx(binDir, webExtOutput);

  return spawnSync(process.execPath, [path.join(repoRoot, "scripts", "lint-firefox-extension.mjs"), `--artifact=${artifact}`], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` }
  });
};

describe("lint-firefox-extension.mjs", () => {
  it("accepts the reviewed React runtime unsafe assignment warnings", () => {
    const result = runFirefoxLint("UNSAFE_VAR_ASSIGNMENT\nUNSAFE_VAR_ASSIGNMENT");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("rejects unexpected Firefox lint warnings even when web-ext exits successfully", () => {
    const result = runFirefoxLint("PERMISSION_FIREFOX_UNSUPPORTED_BY_ANDROID");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Unexpected Firefox lint warning");
  });
});
