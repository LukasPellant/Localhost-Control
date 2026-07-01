#!/usr/bin/env node
import { cp, access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash, generateKeyPairSync } from "node:crypto";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { parseArgs } from "./lib/cli-args.mjs";

export const HOST_NAME = "com.localhost_control.host";
export const BROWSER_SMOKE_HOST_NAME = "com.localhost_control.host_smoke";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
const supportedAutomatedBrowsers = new Set(["chrome", "brave"]);

export const parseBrowserNativeSmokeArgs = (argv = process.argv.slice(2)) => {
  const args = parseArgs(argv);
  const browser = args.get("browser") ?? "chrome";
  const parsed = {
    browser,
    browserExe: args.get("browser-exe"),
    extensionDir: path.resolve(args.get("extension-dir") ?? path.join(repoRoot, "packages", "extension", "dist")),
    hostName: args.get("host-name") ?? BROWSER_SMOKE_HOST_NAME,
    hostPath: path.resolve(
      args.get("host-path") ??
        (process.platform === "win32"
          ? path.join(repoRoot, "installer", "windows", "out", "localhost-control-host.exe")
          : path.join(repoRoot, "target", "release", "localhost-control-host"))
    ),
    required: args.get("required") === "true",
    manualGate: args.get("manual-gate") === "true",
    timeoutMs: Number(args.get("timeout-ms") ?? 30_000)
  };
  if (!["chrome", "brave", "firefox"].includes(parsed.browser)) {
    throw new Error("Unsupported browser. Use chrome, brave, or firefox.");
  }
  return parsed;
};

export const buildChromiumLaunchArgs = ({ extensionDir, initialUrl = "about:blank", remoteDebuggingPort, userDataDir }) => [
  `--remote-debugging-port=${remoteDebuggingPort}`,
  `--user-data-dir=${userDataDir}`,
  `--disable-extensions-except=${extensionDir}`,
  `--load-extension=${extensionDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-networking",
  initialUrl
];

export const buildChromiumNativeManifest = ({ extensionId, hostName = HOST_NAME, hostPath }) => ({
  name: hostName,
  description: "Localhost Control native messaging host",
  path: hostPath,
  type: "stdio",
  allowed_origins: [`chrome-extension://${extensionId}/`]
});

export const computeChromiumExtensionId = (manifestPublicKey) => {
  const keyBytes = Buffer.from(manifestPublicKey, "base64");
  const digest = createHash("sha256").update(keyBytes).digest().subarray(0, 16);
  return [...digest]
    .map((byte) => `${"abcdefghijklmnop"[byte >> 4]}${"abcdefghijklmnop"[byte & 0x0f]}`)
    .join("");
};

const createChromiumManifestKey = () => {
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return publicKey.export({ type: "spki", format: "der" }).toString("base64");
};

const prepareChromiumExtensionCopy = async ({ extensionDir, tempRoot }) => {
  const keyedExtensionDir = path.join(tempRoot, "keyed-extension");
  await cp(extensionDir, keyedExtensionDir, { recursive: true });
  const manifestPath = path.join(keyedExtensionDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const key = createChromiumManifestKey();
  manifest.key = key;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    extensionDir: keyedExtensionDir,
    extensionId: computeChromiumExtensionId(key)
  };
};

export const chromiumRegistrySuffixes = (browser, hostName = HOST_NAME) => {
  const sharedChromiumSuffixes = [
    `Chromium\\NativeMessagingHosts\\${hostName}`,
    `WOW6432Node\\Chromium\\NativeMessagingHosts\\${hostName}`,
    `Microsoft\\Edge\\NativeMessagingHosts\\${hostName}`,
    `WOW6432Node\\Microsoft\\Edge\\NativeMessagingHosts\\${hostName}`
  ];
  if (browser === "brave") {
    return [
      `BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\${hostName}`,
      `WOW6432Node\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\${hostName}`,
      `Google\\Chrome\\NativeMessagingHosts\\${hostName}`,
      `WOW6432Node\\Google\\Chrome\\NativeMessagingHosts\\${hostName}`,
      ...sharedChromiumSuffixes
    ];
  }
  return [
    `Google\\Chrome\\NativeMessagingHosts\\${hostName}`,
    `WOW6432Node\\Google\\Chrome\\NativeMessagingHosts\\${hostName}`,
    ...sharedChromiumSuffixes
  ];
};

const chromiumUserManifestPaths = (browser, homeDir, hostName = HOST_NAME) => {
  if (process.platform === "darwin") {
    const root =
      browser === "brave"
        ? path.join(homeDir, "Library", "Application Support", "BraveSoftware", "Brave-Browser")
        : path.join(homeDir, "Library", "Application Support", "Google", "Chrome");
    return [path.join(root, "NativeMessagingHosts", `${hostName}.json`)];
  }
  const root =
    browser === "brave"
      ? path.join(homeDir, ".config", "BraveSoftware", "Brave-Browser")
      : path.join(homeDir, ".config", "google-chrome");
  return [path.join(root, "NativeMessagingHosts", `${hostName}.json`)];
};

const queryRegistryValue = (suffix) => {
  const result = spawnSync("reg.exe", ["query", `HKCU\\Software\\${suffix}`, "/ve"], { encoding: "utf8" });
  if (result.status !== 0) return { exists: false };
  const match = /\(Default\)\s+REG_SZ\s+(.+)/.exec(result.stdout);
  return match ? { exists: true, value: match[1].trim() } : { exists: true, value: undefined };
};

const writeRegistryValue = (suffix, value) => {
  const result = spawnSync("reg.exe", ["add", `HKCU\\Software\\${suffix}`, "/ve", "/t", "REG_SZ", "/d", value, "/f"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Unable to register native host at HKCU\\Software\\${suffix}: ${result.stderr || result.stdout}`);
};

const deleteRegistryValue = (suffix) => {
  spawnSync("reg.exe", ["delete", `HKCU\\Software\\${suffix}`, "/ve", "/f"], { encoding: "utf8" });
};

const deleteRegistryKey = (suffix) => {
  spawnSync("reg.exe", ["delete", `HKCU\\Software\\${suffix}`, "/f"], { encoding: "utf8" });
};

export const buildWindowsBrowserCleanupCommand = () =>
  [
    "$profile = $env:LOCALHOST_CONTROL_BROWSER_USER_DATA_DIR",
    "if (!$profile) { exit 0 }",
    "Get-CimInstance Win32_Process |",
    "  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profile) } |",
    "  ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate | Out-Null }"
  ].join(" ");

const registerNativeHost = async ({ browser, extensionId, hostName, hostPath, tempRoot, homeDir }) => {
  const manifestPath = path.join(tempRoot, `${hostName}.${browser}.json`);
  await writeFile(manifestPath, `${JSON.stringify(buildChromiumNativeManifest({ extensionId, hostName, hostPath }), null, 2)}\n`);

  if (process.platform === "win32") {
    const previous = chromiumRegistrySuffixes(browser, hostName).map((suffix) => ({ suffix, state: queryRegistryValue(suffix) }));
    for (const target of previous) writeRegistryValue(target.suffix, manifestPath);
    return {
      env: {},
      cleanup: () => {
        for (const target of previous) {
          if (target.state.value) writeRegistryValue(target.suffix, target.state.value);
          else if (target.state.exists) deleteRegistryValue(target.suffix);
          else deleteRegistryKey(target.suffix);
        }
      }
    };
  }

  for (const target of chromiumUserManifestPaths(browser, homeDir, hostName)) {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(buildChromiumNativeManifest({ extensionId, hostName, hostPath }), null, 2)}\n`);
  }
  return { env: { HOME: homeDir }, cleanup: () => {} };
};

const findOnPath = (command) => {
  const result = spawnSync(process.platform === "win32" ? "where.exe" : "which", [command], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.split(/\r?\n/).find(Boolean) : undefined;
};

const browserCandidates = (browser) => {
  if (process.platform === "win32") {
    const roots = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean);
    return browser === "brave"
      ? roots.map((root) => path.join(root, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"))
      : roots.map((root) => path.join(root, "Google", "Chrome", "Application", "chrome.exe"));
  }
  if (process.platform === "darwin") {
    return browser === "brave"
      ? ["/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"]
      : ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  }
  return browser === "brave"
    ? ["brave-browser", "brave"].map(findOnPath).filter(Boolean)
    : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].map(findOnPath).filter(Boolean);
};

const locateBrowserExecutable = async ({ browser, browserExe, required }) => {
  const candidates = browserExe ? [browserExe] : browserCandidates(browser);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  const message = `Skipping browser native smoke: ${browser} executable was not found. Pass --browser-exe or --required.`;
  if (required) throw new Error(message);
  console.log(message);
  return undefined;
};

const freePort = async () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });

const removeTempRoot = async (tempRoot) => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rm(tempRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!["EBUSY", "ENOTEMPTY", "EPERM"].includes(error?.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
  await rm(tempRoot, { recursive: true, force: true });
};

const terminateBrowserProcesses = (child, userDataDir) => {
  if (child && !child.killed) child.kill();
  if (process.platform !== "win32") return;
  spawnSync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", buildWindowsBrowserCleanupCommand()],
    {
      encoding: "utf8",
      env: { ...process.env, LOCALHOST_CONTROL_BROWSER_USER_DATA_DIR: userDataDir }
    }
  );
};

const launchChromiumBrowser = ({ browserExe, extensionDir, initialUrl, remoteDebuggingPort, userDataDir, env }) => {
  const child = spawn(browserExe, buildChromiumLaunchArgs({ extensionDir, initialUrl, remoteDebuggingPort, userDataDir }), {
    env: { ...process.env, ...env },
    stdio: "ignore"
  });
  child.unref();
  return child;
};

const fetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} while fetching ${url}`);
  return response.json();
};

const waitFor = async (fn, timeoutMs, label) => {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
};

const withTimeout = (promise, timeoutMs, label) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
  }

  async open() {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("message", (event) => this.onMessage(event));
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
  }

  onMessage(event) {
    const message = JSON.parse(event.data);
    if (!message.id || !this.pending.has(message.id)) return;
    const { resolve, reject } = this.pending.get(message.id);
    this.pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  }

  call(method, params = {}, sessionId) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  close() {
    this.socket?.close();
  }
}

const targetPriority = (target) => (target.type === "page" ? 0 : target.type === "background_page" ? 1 : 2);

const targetHasNativeMessaging = async (cdp, target) => {
  const { sessionId } = await cdp.call("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  try {
    const result = await cdp.call(
      "Runtime.evaluate",
      {
        expression: "Boolean((globalThis.chrome || globalThis.browser)?.runtime?.sendNativeMessage)",
        returnByValue: true
      },
      sessionId
    );
    return result.result?.value === true;
  } finally {
    await cdp.call("Target.detachFromTarget", {}, sessionId).catch(() => undefined);
  }
};

const discoverExtensionTarget = async (cdp, timeoutMs) =>
  waitFor(async () => {
    const { targetInfos } = await cdp.call("Target.getTargets");
    const extensionTargets = targetInfos
      .filter((target) => ["service_worker", "background_page", "page"].includes(target.type) && /^chrome-extension:\/\//.test(target.url))
      .sort((left, right) => targetPriority(left) - targetPriority(right));
    for (const target of extensionTargets) {
      if (await targetHasNativeMessaging(cdp, target)) return target;
    }
    return undefined;
  }, timeoutMs, "extension target with native messaging API");

export const describeRuntimeEvaluationFailure = (evaluation) => {
  const details = evaluation?.exceptionDetails;
  const exception = details?.exception;
  return exception?.description ?? details?.text ?? evaluation?.result?.description ?? JSON.stringify(evaluation);
};

const runNativeVersionInExtension = async ({ browserWsUrl, hostName, timeoutMs, expectedVersion }) => {
  const cdp = new CdpClient(browserWsUrl);
  await cdp.open();
  try {
    const target = await discoverExtensionTarget(cdp, timeoutMs);
    const extensionId = new URL(target.url).host;
    return {
      extensionId,
      async requestVersion() {
        const { sessionId } = await cdp.call("Target.attachToTarget", { targetId: target.targetId, flatten: true });
        const expression = `
          (() => {
            const api = globalThis.chrome || globalThis.browser;
            if (!api?.runtime?.sendNativeMessage) throw new Error("Native messaging API is not available in the selected extension target.");
            return api.runtime.sendNativeMessage("${hostName}", { id: "browser-native-smoke", method: "version" });
          })()
        `;
        const result = await withTimeout(
          cdp.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId),
          Math.min(timeoutMs, 10_000),
          "native messaging version response"
        );
        if (result.exceptionDetails) {
          throw new Error(`Native message evaluation failed: ${describeRuntimeEvaluationFailure(result)}`);
        }
        const response = result.result?.value;
        if (response?.id !== "browser-native-smoke" || response?.result?.version !== expectedVersion) {
          throw new Error(`Unexpected native host version response: ${JSON.stringify(response)}`);
        }
        return response;
      },
      close: () => cdp.close()
    };
  } catch (error) {
    cdp.close();
    throw error;
  }
};

const fetchBrowserVersion = (remoteDebuggingPort, timeoutMs) =>
  waitFor(
    () => fetchJson(`http://127.0.0.1:${remoteDebuggingPort}/json/version`),
    timeoutMs,
    "browser DevTools endpoint"
  );

const runChromiumSmoke = async (options) => {
  await access(path.join(options.extensionDir, "manifest.json"));
  await access(options.hostPath);
  const browserExe = await locateBrowserExecutable(options);
  if (!browserExe) return;

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "localhost-control-browser-native-"));
  const remoteDebuggingPort = await freePort();
  const smokeUserDataDir = path.join(tempRoot, "smoke-profile");
  const browserHomeDir = path.join(tempRoot, "home");
  const browserEnv = process.platform === "win32" ? {} : { HOME: browserHomeDir };
  let child;
  let registration;
  let probe;
  try {
    const keyedExtension = await prepareChromiumExtensionCopy({ extensionDir: options.extensionDir, tempRoot });
    registration = await registerNativeHost({ ...options, extensionId: keyedExtension.extensionId, tempRoot, homeDir: browserHomeDir });
    child = launchChromiumBrowser({
      ...options,
      browserExe,
      extensionDir: keyedExtension.extensionDir,
      initialUrl: `chrome-extension://${keyedExtension.extensionId}/sidepanel.html`,
      remoteDebuggingPort,
      userDataDir: smokeUserDataDir,
      env: browserEnv
    });
    const smokeVersion = await fetchBrowserVersion(remoteDebuggingPort, options.timeoutMs);
    probe = await runNativeVersionInExtension({
      browserWsUrl: smokeVersion.webSocketDebuggerUrl,
      hostName: options.hostName,
      timeoutMs: options.timeoutMs,
      expectedVersion: packageJson.version
    });
    if (probe.extensionId !== keyedExtension.extensionId) {
      throw new Error(`Loaded extension id ${probe.extensionId} did not match keyed smoke extension ${keyedExtension.extensionId}`);
    }
    await probe.requestVersion();
    console.log(`Browser native smoke passed for ${options.browser} with extension ${keyedExtension.extensionId}.`);
  } finally {
    probe?.close();
    try {
      registration?.cleanup();
    } catch (error) {
      console.warn(`Browser native smoke registry cleanup warning: ${error instanceof Error ? error.message : String(error)}`);
    }
    terminateBrowserProcesses(child, smokeUserDataDir);
    try {
      await removeTempRoot(tempRoot);
    } catch (error) {
      console.warn(`Browser native smoke temp cleanup warning: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
};

const printFirefoxManualGate = () => {
  console.log("Firefox browser-native smoke is a manual release gate for now.");
  console.log("Load the signed Firefox package, install the matching native host, and verify the panel can scan or request version through native messaging.");
};

export const main = async (argv = process.argv.slice(2)) => {
  const options = parseBrowserNativeSmokeArgs(argv);
  if (options.browser === "firefox") {
    if (options.manualGate) {
      printFirefoxManualGate();
      return;
    }
    throw new Error("Firefox browser-native automation is not implemented yet. Use --manual-gate for the documented release check.");
  }
  if (!supportedAutomatedBrowsers.has(options.browser)) throw new Error(`Browser ${options.browser} is not automated by this smoke script.`);
  await runChromiumSmoke(options);
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
