#!/usr/bin/env node
import { cp, access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash, generateKeyPairSync } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { parseArgs } from "./lib/cli-args.mjs";

export const HOST_NAME = "com.localhost_control.host";
export const BROWSER_SMOKE_HOST_NAME = "com.localhost_control.host_smoke";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
const supportedAutomatedBrowsers = new Set(["chrome", "brave", "firefox"]);
const defaultFirefoxExtensionId = "localhost-control@lukaspellant.dev";

export const parseBrowserNativeSmokeArgs = (argv = process.argv.slice(2)) => {
  const args = parseArgs(argv);
  const browser = args.get("browser") ?? "chrome";
  const useInstalledHost = args.get("use-installed-host") === "true";
  const parsed = {
    browser,
    browserExe: args.get("browser-exe"),
    extensionDir: path.resolve(args.get("extension-dir") ?? path.join(repoRoot, "packages", "extension", "dist")),
    extensionId: args.get("extension-id") ?? (browser === "firefox" && useInstalledHost ? defaultFirefoxExtensionId : undefined),
    headless: args.get("headless") === "true",
    hostName: args.get("host-name") ?? (useInstalledHost ? HOST_NAME : BROWSER_SMOKE_HOST_NAME),
    hostPath: path.resolve(
      args.get("host-path") ??
        (process.platform === "win32"
          ? path.join(repoRoot, "installer", "windows", "out", "localhost-control-host.exe")
          : path.join(repoRoot, "target", "release", "localhost-control-host"))
    ),
    required: args.get("required") === "true",
    manualGate: args.get("manual-gate") === "true",
    manualConfirmed: args.get("manual-confirmed") === "true" || process.env.FIREFOX_NATIVE_SMOKE_CONFIRMED === "true",
    useInstalledHost,
    timeoutMs: Number(args.get("timeout-ms") ?? 30_000)
  };
  if (!["chrome", "brave", "firefox"].includes(parsed.browser)) {
    throw new Error("Unsupported browser. Use chrome, brave, or firefox.");
  }
  return parsed;
};

export const buildChromiumLaunchArgs = ({ extensionDir, headless = false, initialUrl = "about:blank", remoteDebuggingPort, userDataDir }) => [
  `--remote-debugging-port=${remoteDebuggingPort}`,
  `--user-data-dir=${userDataDir}`,
  `--disable-extensions-except=${extensionDir}`,
  `--load-extension=${extensionDir}`,
  ...(headless ? ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] : []),
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

export const buildFirefoxNativeManifest = ({ extensionId, hostName = HOST_NAME, hostPath }) => ({
  name: hostName,
  description: "Localhost Control native messaging host",
  path: hostPath,
  type: "stdio",
  allowed_extensions: [extensionId]
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

export const firefoxUserManifestPaths = (homeDir, hostName = HOST_NAME, platform = process.platform) => {
  if (platform === "darwin") {
    return [path.join(homeDir, "Library", "Application Support", "Mozilla", "NativeMessagingHosts", `${hostName}.json`)];
  }
  return [path.join(homeDir, ".mozilla", "native-messaging-hosts", `${hostName}.json`)];
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

const registerFirefoxNativeHost = async ({ extensionId, hostName, hostPath, tempRoot, homeDir }) => {
  const manifestPath = path.join(tempRoot, `${hostName}.firefox.json`);
  await writeFile(manifestPath, `${JSON.stringify(buildFirefoxNativeManifest({ extensionId, hostName, hostPath }), null, 2)}\n`);

  if (process.platform === "win32") {
    const suffix = `Mozilla\\NativeMessagingHosts\\${hostName}`;
    const previous = queryRegistryValue(suffix);
    writeRegistryValue(suffix, manifestPath);
    return {
      env: {},
      cleanup: () => {
        if (previous.value) writeRegistryValue(suffix, previous.value);
        else if (previous.exists) deleteRegistryValue(suffix);
        else deleteRegistryKey(suffix);
      }
    };
  }

  for (const target of firefoxUserManifestPaths(homeDir, hostName)) {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(buildFirefoxNativeManifest({ extensionId, hostName, hostPath }), null, 2)}\n`);
  }
  return { env: { HOME: homeDir }, cleanup: () => {} };
};

const findOnPath = (command) => {
  const result = spawnSync(process.platform === "win32" ? "where.exe" : "which", [command], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.split(/\r?\n/).find(Boolean) : undefined;
};

export const browserExecutableCommandNames = (browser, platform = process.platform) => {
  if (browser === "brave") return ["brave-browser", "brave"];
  if (browser === "firefox") return ["firefox"];
  if (platform !== "linux") return [];
  return ["google-chrome", "google-chrome-stable"];
};

export const browserCandidates = (browser) => {
  const pathCandidates = browserExecutableCommandNames(browser).map(findOnPath).filter(Boolean);
  if (process.platform === "win32") {
    const roots = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean);
    if (browser === "brave") return [...pathCandidates, ...roots.map((root) => path.join(root, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"))];
    if (browser === "firefox") return [...pathCandidates, ...roots.map((root) => path.join(root, "Mozilla Firefox", "firefox.exe"))];
    return roots.map((root) => path.join(root, "Google", "Chrome", "Application", "chrome.exe"));
  }
  if (process.platform === "darwin") {
    if (browser === "brave") return [...pathCandidates, "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"];
    if (browser === "firefox") return [...pathCandidates, "/Applications/Firefox.app/Contents/MacOS/firefox"];
    return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  }
  return pathCandidates;
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

const ensurePathAvailable = async ({ label, path: targetPath, required }) => {
  try {
    await access(targetPath);
    return true;
  } catch {
    const message = `Skipping browser native smoke: ${label} was not found at ${targetPath}.`;
    if (required) throw new Error(message);
    console.log(message);
    return false;
  }
};

const freePort = async () =>
  new Promise((resolve, reject) => {
    const server = createNetServer();
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

const waitForChildClose = async (child, timeoutMs = 3_000) => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise((resolve) => child.once("close", resolve)),
    new Promise((resolve) => setTimeout(resolve, timeoutMs))
  ]);
};

export const webExtCliPath = () => path.join(repoRoot, "node_modules", "web-ext", "bin", "web-ext.js");

const launchChromiumBrowser = ({ browserExe, extensionDir, headless, initialUrl, remoteDebuggingPort, userDataDir, env }) => {
  const child = spawn(browserExe, buildChromiumLaunchArgs({ extensionDir, headless, initialUrl, remoteDebuggingPort, userDataDir }), {
    env: { ...process.env, ...env },
    stdio: "ignore"
  });
  child.unref();
  return child;
};

export const buildFirefoxSmokeManifest = ({ extensionId }) => ({
  manifest_version: 2,
  name: "Localhost Control Firefox native smoke",
  version: packageJson.version,
  applications: {
    gecko: {
      id: extensionId
    }
  },
  permissions: ["nativeMessaging", "http://127.0.0.1/*"],
  background: {
    scripts: ["background.js"]
  }
});

const buildFirefoxSmokeBackground = ({ callbackUrl, hostName }) => `
const report = async (payload) => {
  try {
    await fetch(${JSON.stringify(callbackUrl)}, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error("Firefox native smoke callback failed", error);
  }
};

(async () => {
  try {
    const response = await browser.runtime.sendNativeMessage(${JSON.stringify(hostName)}, {
      id: "browser-native-smoke",
      method: "version"
    });
    await report({ ok: true, response });
  } catch (error) {
    await report({ ok: false, error: error?.message ?? String(error) });
  }
})();
`;

const prepareFirefoxSmokeExtension = async ({ callbackUrl, extensionId, hostName, tempRoot }) => {
  const extensionDir = path.join(tempRoot, "firefox-smoke-extension");
  await mkdir(extensionDir, { recursive: true });
  await writeFile(path.join(extensionDir, "manifest.json"), `${JSON.stringify(buildFirefoxSmokeManifest({ extensionId }), null, 2)}\n`);
  await writeFile(path.join(extensionDir, "background.js"), buildFirefoxSmokeBackground({ callbackUrl, hostName }));
  return extensionDir;
};

const startFirefoxSmokeCallback = async () => {
  let resolveResult;
  let rejectResult;
  const resultPromise = new Promise((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const server = createHttpServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/result") {
      response.writeHead(404).end();
      return;
    }
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      try {
        const body = Buffer.concat(chunks).toString("utf8");
        resolveResult(JSON.parse(body));
        response.writeHead(200, { "content-type": "text/plain" }).end("ok");
      } catch (error) {
        rejectResult(error);
        response.writeHead(400).end();
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    callbackUrl: `http://127.0.0.1:${address.port}/result`,
    resultPromise,
    close: () => new Promise((resolve) => server.close(resolve))
  };
};

const launchFirefoxWebExt = ({ browserExe, extensionDir, headless, profileDir, env }) => {
  const args = [
    webExtCliPath(),
    "run",
    "--source-dir",
    extensionDir,
    "--firefox",
    browserExe,
    "--firefox-profile",
    profileDir,
    "--profile-create-if-missing",
    "--keep-profile-changes",
    "--no-reload",
    "--no-input",
    "--start-url",
    "about:blank",
    ...(headless ? ["--arg=-headless"] : [])
  ];
  return spawn(process.execPath, args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });
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
  if (!(await ensurePathAvailable({ label: "extension manifest", path: path.join(options.extensionDir, "manifest.json"), required: options.required }))) return;
  if (!(await ensurePathAvailable({ label: "native host", path: options.hostPath, required: options.required }))) return;
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
      env: { ...browserEnv, ...registration.env }
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
    await waitForChildClose(child);
    try {
      await removeTempRoot(tempRoot);
    } catch (error) {
      console.warn(`Browser native smoke temp cleanup warning: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
};

const runFirefoxSmoke = async (options) => {
  if (!(await ensurePathAvailable({ label: "native host", path: options.hostPath, required: options.required }))) return;
  const browserExe = await locateBrowserExecutable(options);
  if (!browserExe) return;

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "localhost-control-firefox-native-"));
  const firefoxHomeDir = path.join(tempRoot, "home");
  const firefoxProfileDir = path.join(tempRoot, "profile");
  const extensionId = options.extensionId ?? "localhost-control-smoke@example.invalid";
  let child;
  let registration;
  let callback;
  const logs = { stdout: "", stderr: "" };
  try {
    await mkdir(firefoxHomeDir, { recursive: true });
    await mkdir(firefoxProfileDir, { recursive: true });
    callback = await startFirefoxSmokeCallback();
    const extensionDir = await prepareFirefoxSmokeExtension({
      callbackUrl: callback.callbackUrl,
      extensionId,
      hostName: options.hostName,
      tempRoot
    });
    registration = options.useInstalledHost
      ? { env: {}, cleanup: () => {} }
      : await registerFirefoxNativeHost({
          ...options,
          extensionId,
          tempRoot,
          homeDir: firefoxHomeDir
        });
    child = launchFirefoxWebExt({
      browserExe,
      extensionDir,
      headless: options.headless,
      profileDir: firefoxProfileDir,
      env: registration.env
    });
    child.stdout?.on("data", (chunk) => {
      logs.stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      logs.stderr += chunk.toString();
    });
    const childExit = new Promise((_, reject) => {
      child.once("exit", (code, signal) => {
        reject(new Error(`Firefox native smoke browser exited before reporting result (${code ?? signal}). ${logs.stderr || logs.stdout}`.trim()));
      });
    });
    const result = await withTimeout(
      Promise.race([callback.resultPromise, childExit]),
      options.timeoutMs,
      "Firefox native messaging smoke result"
    );
    if (!result?.ok) throw new Error(`Firefox native smoke failed: ${result?.error ?? JSON.stringify(result)}`);
    const response = result.response;
    if (response?.id !== "browser-native-smoke" || response?.result?.version !== packageJson.version) {
      throw new Error(`Unexpected Firefox native host version response: ${JSON.stringify(response)}`);
    }
    console.log(`Browser native smoke passed for firefox with extension ${extensionId}.`);
  } finally {
    try {
      registration?.cleanup();
    } catch (error) {
      console.warn(`Firefox native smoke registry cleanup warning: ${error instanceof Error ? error.message : String(error)}`);
    }
    terminateBrowserProcesses(child, firefoxProfileDir);
    await waitForChildClose(child);
    await callback?.close().catch(() => undefined);
    try {
      await removeTempRoot(tempRoot);
    } catch (error) {
      console.warn(`Firefox native smoke temp cleanup warning: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
};

const printFirefoxManualGate = () => {
  console.log("Firefox browser-native smoke manual release gate recorded.");
  console.log("Load the signed Firefox package, install the matching native host, and verify the panel can scan or request version through native messaging.");
};

export const main = async (argv = process.argv.slice(2)) => {
  const options = parseBrowserNativeSmokeArgs(argv);
  if (options.useInstalledHost && options.browser !== "firefox") {
    throw new Error("Installed native host manifest smoke is currently supported only for Firefox, where the smoke extension can use the packaged Gecko id.");
  }
  if (options.browser === "firefox") {
    if (options.manualGate) {
      if (options.required && !options.manualConfirmed) {
        throw new Error(
          "Firefox browser-native smoke is a required manual release gate. Re-run after verifying Firefox with FIREFOX_NATIVE_SMOKE_CONFIRMED=true or --manual-confirmed."
        );
      }
      printFirefoxManualGate();
      return;
    }
    await runFirefoxSmoke(options);
    return;
  }
  if (!supportedAutomatedBrowsers.has(options.browser)) throw new Error(`Browser ${options.browser} is not automated by this smoke script.`);
  await runChromiumSmoke(options);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (process.env.GITHUB_ACTIONS === "true") {
      console.error(`::error title=Browser native smoke failed::${message.replace(/\r?\n/g, "%0A")}`);
    }
    console.error(message);
    process.exit(1);
  });
}
