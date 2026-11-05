import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, powerMonitor } from "electron";
import { nativeImage, powerSaveBlocker, session, shell } from "electron";
import {
  connectDaemonEvents,
  daemonRpc,
  hurryDaemonShutdown,
  killDaemon,
  setDaemonExitHandler,
  startDaemon,
  stopDaemon,
  type DaemonConnection,
} from "./daemon";
import { QUIT_PROBE_TIMEOUT_MS, SHUTDOWN_NOW_TIMEOUT_MS, settleInvoke } from "./daemonProtocol";
import { IDLE_WORK, parseWorkReport, workKeepsAwake, type WorkReport } from "./workReport";
import {
  classifyDroppedPath,
  readDroppedImportPaths,
  readDroppedPathRange,
  statDroppedImportPaths,
} from "./droppedImport";
import { ELECTRON_IPC_METHODS } from "./ipcMethods";
import { quitCopyForLocale } from "./quitCopy";
import { retrievePortalTransferPaths } from "./portalFileTransfer";
import { isAbsoluteOsPath, revealOsPathInFileManager } from "./revealInFileManager";
import { externalNavigationUrl } from "./externalNavigation";
import {
  runBundledWinFspInstaller,
  winfspInstallSucceeded,
  winfspRuntimeDllPaths,
  winfspScriptCandidates,
} from "./ensureWinFsp";
import {
  fuseInstallPlan,
  fuseRuntimeReady,
  resolveSystemBinary,
  runFuseInstall,
} from "./ensureFuse";
import { createDefaultTerminalHost, openOsPathInTerminal } from "./openInTerminal";

const isDev = process.argv.includes("--dev") || process.env.UPRIV_DEV === "1";
/** Open detached DevTools in dev; pass `--no-devtools` to skip. */
const openDevTools = isDev && !process.argv.includes("--no-devtools");

/**
 * Linux AppImage FUSE (`nosuid`) breaks Chromium's SUID sandbox
 * (`setuid_sandbox_host.cc` → Trace/breakpoint trap under `/tmp/.mount_Upriv-*`).
 * Packaged AppImage also wraps the binary in `afterPack` so `--no-sandbox` is on
 * argv *before* Chromium starts when `$APPIMAGE` names a real file.
 * `.deb` installs keep the real sandbox (wrapper does not pass --no-sandbox).
 * Renderer `webPreferences.sandbox` stays enabled.
 *
 * Require `$APPIMAGE` to be an existing file (same as Rust) so a spoofed
 * `APPIMAGE=1` on a `.deb` install does not disable sandbox. Real AppImageKit
 * always points at the AppImage path on disk.
 */
function isRealAppImageEnv(): boolean {
  const appImage = process.env.APPIMAGE;
  if (!appImage) return false;
  try {
    return fs.existsSync(appImage) && fs.statSync(appImage).isFile();
  } catch {
    return false;
  }
}

if (isRealAppImageEnv()) {
  process.env.ELECTRON_DISABLE_SANDBOX = "1";
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-setuid-sandbox");
}

let mainWindow: BrowserWindow | null = null;
let daemon: DaemonConnection | null = null;
let daemonStarting: Promise<DaemonConnection> | null = null;
let stopEvents: (() => void) | null = null;
let quitting = false;
let quitPrompting = false;
/** The quit became Close now (dialog, overlay, or the OS ending the session). */
let quitNow = false;
/** The renderer's running work, as it last reported it. */
let work: WorkReport = IDLE_WORK;
/** Resolves the wait of a normal quit once the jobs end, or Close now is asked. */
let jobsSettled: (() => void) | null = null;
let keepAwakeId: number | null = null;

type QuitChoice = "flush" | "now" | "cancel";

function parseOpenDialogFilters(raw: unknown): Electron.FileFilter[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const filters: Electron.FileFilter[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as { name?: unknown; extensions?: unknown };
    if (typeof record.name !== "string" || !Array.isArray(record.extensions)) continue;
    const extensions = record.extensions.filter((ext): ext is string => typeof ext === "string");
    if (extensions.length === 0) continue;
    filters.push({ name: record.name, extensions });
  }
  return filters.length > 0 ? filters : undefined;
}

function finiteTimeoutMs(timeoutMs: unknown): number | undefined {
  return typeof timeoutMs === "number" && Number.isFinite(timeoutMs) ? timeoutMs : undefined;
}

const ALLOWED_IPC_METHODS = new Set<string>(ELECTRON_IPC_METHODS);

/** Window / taskbar icon while running (Explorer/Start still need .exe resources). */
function resolveWindowIcon(): string | undefined {
  const candidates = [
    path.join(process.resourcesPath, "icons/icon.ico"),
    path.join(process.resourcesPath, "icons/icon.png"),
    path.join(__dirname, "../build/icons/icon.ico"),
    path.join(__dirname, "../build/icons/icon.png"),
    path.join(__dirname, "../renderer/Upriv-icon.png"),
    path.join(__dirname, "../../desktop/public/Upriv-icon.png"),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

function applyProductionCsp(): void {
  if (isDev) return;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:",
        ],
      },
    });
  });
}

function buildApplicationMenu(): Menu {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [{ role: "quit" }],
    },
  ];
  return Menu.buildFromTemplate(template);
}

function hardenProductionWindow(window: BrowserWindow): void {
  if (isDev) return;

  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const key = input.key.toLowerCase();
    const reload = key === "f5" || ((input.control || input.meta) && key === "r");
    if (reload) event.preventDefault();
  });
}

async function ensureDaemon(): Promise<DaemonConnection> {
  if (daemon?.alive) return daemon;
  if (quitting) throw new Error("Upriv is shutting down");
  // Serialize concurrent callers so only one daemon is ever spawned.
  if (daemonStarting) return daemonStarting;

  daemonStarting = (async () => {
    const connection = await startDaemon();
    daemon = connection;
    setDaemonExitHandler(() => {
      daemon = null;
      // Notify renderer so version cache can clear before we force-quit (B9).
      mainWindow?.webContents.send("upriv-event", "daemon_exited", null);
      dialog.showErrorBox("Upriv", "The vault backend stopped unexpectedly. The app will close.");
      void gracefulShutdown(1);
    });
    stopEvents?.();
    stopEvents = connectDaemonEvents(connection, (name, payload) => {
      mainWindow?.webContents.send("upriv-event", name, payload);
    });
    return connection;
  })();

  try {
    return await daemonStarting;
  } finally {
    daemonStarting = null;
  }
}

async function resolveVaultMountOsPath(
  params: Record<string, unknown>,
  timeoutMs: number | undefined,
): Promise<string> {
  const vaultId = typeof params?.vaultId === "string" ? params.vaultId.trim() : "";
  const logicalPath = typeof params?.path === "string" ? params.path : "/";
  if (!vaultId) {
    throw new Error("invalid_request: vaultId is required");
  }
  const activeDaemon = await ensureDaemon();
  const resolved = await daemonRpc(
    activeDaemon,
    "vault_fs_os_path",
    { id: vaultId, path: logicalPath },
    timeoutMs,
  );
  const record =
    typeof resolved === "object" && resolved !== null
      ? (resolved as { osPath?: unknown; reason?: unknown })
      : {};
  const osPath = typeof record.osPath === "string" ? record.osPath.trim() : "";
  if (!osPath) {
    if (record.reason === "unsupported_filesystem") {
      throw new Error("vault_mount_filesystem: the disk cannot hold the file manager folder");
    }
    throw new Error("vault_mount_failed: OS mount is not available");
  }
  return osPath;
}

async function teardownDaemon(now: boolean): Promise<void> {
  stopEvents?.();
  stopEvents = null;
  // A daemon stopped for running out of time is not an unexpected exit.
  setDaemonExitHandler(null);
  await stopDaemon(daemon, { now });
  daemon = null;
}

/**
 * Quit. A normal quit first waits for the renderer's jobs (the overlay lists
 * them, each with Stop), then closes every vault with its backup, with no
 * deadline. Close now stops everything and quits within
 * `SHUTDOWN_NOW_TIMEOUT_MS`.
 */
async function gracefulShutdown(exitCode = 0, now = false): Promise<void> {
  if (quitting) {
    if (now) await requestQuitNow();
    return;
  }
  quitting = true;
  quitNow = now;
  await showQuitClosing(now);
  if (!now) await jobsToSettle();
  await teardownDaemon(quitNow);
  app.exit(exitCode);
}

function jobsToSettle(): Promise<void> {
  if (work.jobs === 0 || quitNow) return Promise.resolve();
  return new Promise((resolve) => {
    jobsSettled = () => {
      jobsSettled = null;
      resolve();
    };
  });
}

/** Close now during a normal quit: stop the jobs and hurry the closes. */
async function requestQuitNow(): Promise<void> {
  if (!quitting || quitNow) return;
  quitNow = true;
  const win = mainWindow;
  if (win && !win.isDestroyed()) win.webContents.send("upriv-event", "quit_closing", { now: true });
  if (jobsSettled) {
    // Still waiting for jobs: the shutdown that follows runs the Close now way.
    jobsSettled();
    return;
  }
  const connection = daemon;
  await hurryDaemonShutdown(connection);
  setTimeout(() => void killDaemon(connection), SHUTDOWN_NOW_TIMEOUT_MS);
}

function applyWorkReport(next: WorkReport): void {
  work = next;
  const awake = workKeepsAwake(next);
  if (awake && keepAwakeId === null) {
    keepAwakeId = powerSaveBlocker.start("prevent-app-suspension");
  } else if (!awake && keepAwakeId !== null) {
    powerSaveBlocker.stop(keepAwakeId);
    keepAwakeId = null;
  }
  if (next.jobs === 0) jobsSettled?.();
}

/** Let the renderer paint a closing overlay before the shutdown RPC blocks this quit. */
async function showQuitClosing(now: boolean): Promise<void> {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  win.webContents.send("upriv-event", "quit_closing", { now });
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 200);
  });
}

async function readUiLocale(): Promise<string> {
  if (!daemon?.alive) return "en";
  try {
    const raw = await daemonRpc(daemon, "app_settings_get", {}, QUIT_PROBE_TIMEOUT_MS);
    if (typeof raw !== "object" || raw === null) return "en";
    const settings = (raw as { settings?: { ui?: { locale?: unknown } } }).settings;
    const locale = settings?.ui?.locale;
    return typeof locale === "string" && locale.trim() ? locale.trim() : "en";
  } catch {
    return "en";
  }
}

/**
 * A vault is open or closing. A daemon that does not answer in time may still
 * hold one, so the quit asks rather than closing without a word.
 */
async function anyVaultSessionOpen(): Promise<boolean> {
  if (!daemon?.alive) return false;
  try {
    const raw = await daemonRpc(daemon, "vault_list", {}, QUIT_PROBE_TIMEOUT_MS);
    if (typeof raw !== "object" || raw === null) return true;
    const vaults = (raw as { vaults?: unknown }).vaults;
    if (!Array.isArray(vaults)) return true;
    return vaults.some((item) => {
      if (typeof item !== "object" || item === null) return false;
      const session = (item as { session?: unknown }).session;
      return session === "open" || session === "closing";
    });
  } catch {
    return true;
  }
}

/** Ask before quitting while a vault is open or the renderer reports work running. */
async function confirmQuitIfBusy(): Promise<QuitChoice> {
  // Both asks at once, each within `QUIT_PROBE_TIMEOUT_MS`, so a busy daemon
  // cannot keep the dialog from showing.
  const [vaultOpen, locale] = await Promise.all([anyVaultSessionOpen(), readUiLocale()]);
  if (!vaultOpen && work.jobs === 0) return "flush";
  const copy = quitCopyForLocale(locale);
  const options: Electron.MessageBoxOptions = {
    type: "warning",
    buttons: [copy.confirm, copy.now, copy.cancel],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    message: vaultOpen ? copy.message : copy.workMessage,
  };
  const result = mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);
  if (result.response === 0) return "flush";
  if (result.response === 1) return "now";
  return "cancel";
}

async function quitFromChoice(choice: QuitChoice): Promise<void> {
  if (choice === "cancel") return;
  await gracefulShutdown(0, choice === "now");
}

async function createWindow(): Promise<void> {
  await ensureDaemon();

  const iconPath = resolveWindowIcon();
  const iconImage = iconPath ? nativeImage.createFromPath(iconPath) : undefined;
  const icon = iconImage && !iconImage.isEmpty() ? iconImage : iconPath;

  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    title: "Upriv",
    // Default-theme `background` in `@upriv/shared` palettes (renderer `index.html` splash).
    backgroundColor: "#081425",
    show: false,
    ...(icon ? { icon } : {}),
    autoHideMenuBar: !isDev,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Windows taskbar / jump-list: pin relaunch to our icon, not Electron defaults.
  if (process.platform === "win32" && iconPath) {
    mainWindow.setAppDetails({
      appId: "com.upriv.desktop",
      appIconPath: iconPath,
      appIconIndex: 0,
      relaunchDisplayName: "Upriv",
    });
    if (iconImage && !iconImage.isEmpty()) {
      mainWindow.setIcon(iconImage);
    }
  }

  const win = mainWindow;
  win.once("ready-to-show", () => win.show());

  hardenProductionWindow(mainWindow);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const allowed = externalNavigationUrl(url);
    if (allowed) void shell.openExternal(allowed);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = isDev ? "http://localhost:1420" : "file://";
    if (!url.startsWith(allowed)) event.preventDefault();
  });

  try {
    if (isDev) {
      await mainWindow.loadURL("http://localhost:1420");
      if (openDevTools) {
        mainWindow.webContents.openDevTools({ mode: "detach" });
      }
    } else {
      await mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
    }
  } finally {
    // `ready-to-show` never fires when the load fails; never leave the window hidden.
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  }

  mainWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    if (quitPrompting) return;
    quitPrompting = true;
    void (async () => {
      try {
        await quitFromChoice(await confirmQuitIfBusy());
      } finally {
        quitPrompting = false;
      }
    })();
  });

  // Windows log-off or shutdown: the OS will not wait for a full close.
  mainWindow.on("session-end", () => {
    void gracefulShutdown(0, true);
  });

  // A renderer that is gone reports nothing more: its work would hold a quit
  // and keep the computer awake for good. `app_shutdown` stops what core still runs.
  mainWindow.webContents.on("render-process-gone", () => {
    applyWorkReport(IDLE_WORK);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    applyWorkReport(IDLE_WORK);
  });
}

ipcMain.on("upriv-work", (_event, report: unknown) => {
  applyWorkReport(parseWorkReport(report));
});

ipcMain.on("upriv-quit-now", () => {
  void requestQuitNow();
});

/** Same CPU count Rust `available_parallelism` uses for the import pool. */
function logicalProcessorCount(): number {
  const count =
    typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  return count >= 1 ? count : 1;
}

ipcMain.on("upriv-logical-processors", (event) => {
  event.returnValue = logicalProcessorCount();
});

ipcMain.handle("upriv-read-dropped", async (_event, paths: unknown) => {
  return readDroppedImportPaths(paths);
});

ipcMain.handle("upriv-stat-dropped", async (_event, paths: unknown) => {
  return statDroppedImportPaths(paths);
});

ipcMain.handle("upriv-classify-dropped", async (_event, osPath: unknown) => {
  return classifyDroppedPath(osPath);
});

ipcMain.handle(
  "upriv-read-dropped-range",
  async (_event, osPath: unknown, offset: unknown, len: unknown) => {
    return readDroppedPathRange(osPath, offset, len);
  },
);

ipcMain.handle("upriv-retrieve-portal-drop", async (_event, key: unknown) => {
  return retrievePortalTransferPaths(key);
});

// A failed call is an answer, not a crash of this handler: a refused password
// or a stopped job must not print as "Error occurred in handler". The preload
// turns `{ ok: false }` back into the `code: message` error the renderer reads.
ipcMain.handle(
  "upriv-invoke",
  (_event, method: string, params: Record<string, unknown>, timeoutMs?: number) =>
    settleInvoke(() => handleInvoke(method, params, timeoutMs)),
);

async function handleInvoke(
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number | undefined,
): Promise<unknown> {
  if (typeof method !== "string" || !ALLOWED_IPC_METHODS.has(method)) {
    throw new Error(`unknown_method: unknown IPC method: ${String(method)}`);
  }

  if (method === "app_exit") {
    await gracefulShutdown(0);
    return null;
  }

  if (method === "pick_directory") {
    const defaultPath =
      typeof params?.defaultPath === "string" && params.defaultPath.trim()
        ? params.defaultPath.trim()
        : undefined;
    const title =
      typeof params?.title === "string" && params.title.trim() ? params.title.trim() : undefined;
    const options: Electron.OpenDialogOptions = {
      properties: ["openDirectory", "createDirectory"],
      ...(title ? { title } : {}),
      ...(defaultPath ? { defaultPath } : {}),
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  }

  if (method === "pick_file") {
    const title =
      typeof params?.title === "string" && params.title.trim() ? params.title.trim() : undefined;
    const filters = parseOpenDialogFilters(params?.filters);
    const options: Electron.OpenDialogOptions = {
      properties: ["openFile"],
      ...(title ? { title } : {}),
      ...(filters ? { filters } : {}),
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  }

  if (method === "reveal_in_file_manager") {
    const osPath = await resolveVaultMountOsPath(params, finiteTimeoutMs(timeoutMs));
    await revealOsPathInFileManager(osPath, fs, shell);
    return null;
  }

  if (method === "reveal_os_path") {
    const target = typeof params?.path === "string" ? params.path.trim() : "";
    if (!isAbsoluteOsPath(target)) {
      throw new Error("open_path_failed: path must be absolute");
    }
    await revealOsPathInFileManager(target, fs, shell);
    return null;
  }

  if (method === "open_in_terminal") {
    const osPath = await resolveVaultMountOsPath(params, finiteTimeoutMs(timeoutMs));
    await openOsPathInTerminal(osPath, fs, createDefaultTerminalHost());
    return null;
  }

  if (method === "winfsp_status") {
    return {
      applicable: process.platform === "win32",
      installed: winFspRuntimeInstalled(),
    };
  }

  if (method === "winfsp_install") {
    if (process.platform !== "win32" || winFspRuntimeInstalled()) {
      return { ok: true };
    }
    const script = winfspScriptCandidates(process.resourcesPath, app.getAppPath()).find((file) =>
      fs.existsSync(file),
    );
    if (!script) return { ok: false };
    const code = await runBundledWinFspInstaller(script);
    return { ok: winfspInstallSucceeded(code) && winFspRuntimeInstalled() };
  }

  if (method === "fuse_status") {
    return {
      applicable: process.platform === "linux",
      installed: fuseRuntimePresent(),
    };
  }

  if (method === "fuse_install") {
    if (process.platform !== "linux" || fuseRuntimePresent()) {
      return { ok: true };
    }
    let osRelease = "";
    try {
      osRelease = fs.readFileSync("/etc/os-release", "utf8");
    } catch {
      return { ok: false };
    }
    const plan = fuseInstallPlan({ osRelease, canExecute: canExecuteFile });
    if (!plan) return { ok: false };
    const code = await runFuseInstall(plan);
    return { ok: code === 0 && fuseRuntimePresent() };
  }

  const activeDaemon = await ensureDaemon();
  return daemonRpc(activeDaemon, method, params, finiteTimeoutMs(timeoutMs));
}

function winFspRuntimeInstalled(): boolean {
  if (process.platform !== "win32") return true;
  return winfspRuntimeDllPaths({
    arch: process.arch,
    programFiles: process.env.ProgramFiles,
    programFilesX86: process.env["ProgramFiles(x86)"],
  }).some((file) => fs.existsSync(file));
}

function fuseRuntimePresent(): boolean {
  if (process.platform !== "linux") return true;
  return fuseRuntimeReady({
    fusermount3: resolveSystemBinary("fusermount3", canExecuteFile) !== null,
    fuseDeviceWritable: canAccessFile("/dev/fuse", fs.constants.R_OK | fs.constants.W_OK),
  });
}

function canExecuteFile(file: string): boolean {
  return canAccessFile(file, fs.constants.X_OK);
}

function canAccessFile(file: string, mode: number): boolean {
  try {
    fs.accessSync(file, mode);
    return true;
  } catch {
    return false;
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
// Single-instance is the concurrency guard for vault-root mutations (setup / alias write).
// A second process only focuses the existing window — it does not run another daemon setup.
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      void createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

function sendPower(payload: "suspend" | "resume"): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("upriv-event", "power", payload);
  }
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  powerMonitor.on("suspend", () => sendPower("suspend"));
  powerMonitor.on("resume", () => sendPower("resume"));
  // Linux and macOS shutdown: the OS will not wait for a full close.
  powerMonitor.on("shutdown", () => {
    void gracefulShutdown(0, true);
  });
  if (process.platform === "win32") {
    app.setAppUserModelId("com.upriv.desktop");
  }
  applyProductionCsp();
  Menu.setApplicationMenu(isDev ? null : buildApplicationMenu());
  void createWindow().catch((error) => {
    console.error("failed to start Upriv", error);
    app.exit(1);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  if (quitPrompting) return;
  quitPrompting = true;
  void (async () => {
    try {
      const choice = await confirmQuitIfBusy();
      if (choice !== "cancel") {
        await quitFromChoice(choice);
        return;
      }
      if (!mainWindow || mainWindow.isDestroyed()) {
        await createWindow();
      }
    } finally {
      quitPrompting = false;
    }
  })();
});

// The OS or a service manager ending the process will not wait: Close now.
process.on("SIGTERM", () => {
  void gracefulShutdown(0, true);
});

if (isDev) {
  // Ctrl+C in the dev terminal quits the normal way.
  process.on("SIGINT", () => {
    if (!quitting) void gracefulShutdown(0);
  });
}

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
