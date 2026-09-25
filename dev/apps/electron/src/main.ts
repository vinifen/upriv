import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import { nativeImage, session, shell } from "electron";
import {
  connectDaemonEvents,
  daemonRpc,
  setDaemonExitHandler,
  startDaemon,
  stopDaemon,
  type DaemonConnection,
} from "./daemon";
import {
  readDroppedImportPaths,
  readDroppedPathRange,
  statDroppedImportPaths,
} from "./droppedImport";
import { ELECTRON_IPC_METHODS } from "./ipcMethods";
import { retrievePortalTransferPaths } from "./portalFileTransfer";
import { revealOsPathInFileManager } from "./revealInFileManager";
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

/** Keep in sync with `warning.vault_open_on_exit*` in shared locales. */
const QUIT_COPY: Record<string, { message: string; confirm: string; now: string; cancel: string }> =
  {
    en: {
      message:
        "A vault is still open. Close it before exiting, or quit now and recover it next time?",
      confirm: "Close and quit",
      now: "Just close",
      cancel: "Cancel",
    },
    "pt-BR": {
      message:
        "Um cofre ainda está aberto. Fechar antes de sair, ou sair agora e recuperar na próxima vez?",
      confirm: "Fechar e sair",
      now: "Só sair",
      cancel: "Cancelar",
    },
    es: {
      message:
        "Una bóveda sigue abierta. ¿Cerrarla antes de salir, o salir ahora y recuperarla la próxima vez?",
      confirm: "Cerrar y salir",
      now: "Solo salir",
      cancel: "Cancelar",
    },
  };

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
  const osPath =
    typeof resolved === "object" &&
    resolved !== null &&
    typeof (resolved as { osPath?: unknown }).osPath === "string"
      ? (resolved as { osPath: string }).osPath.trim()
      : "";
  if (!osPath) {
    throw new Error("vault_mount_failed: OS mount is not available");
  }
  return osPath;
}

async function teardownDaemon(flush: boolean): Promise<void> {
  stopEvents?.();
  stopEvents = null;
  await stopDaemon(daemon, { flush });
  daemon = null;
  setDaemonExitHandler(null);
}

async function gracefulShutdown(exitCode = 0, flush = true): Promise<void> {
  if (quitting) return;
  quitting = true;
  if (flush) await showQuitClosing();
  await teardownDaemon(flush);
  app.exit(exitCode);
}

/** Let the renderer paint a closing overlay before the flush RPC blocks this quit. */
async function showQuitClosing(): Promise<void> {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  win.webContents.send("upriv-event", "quit_closing", null);
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 200);
  });
}

function quitCopyForLocale(locale: string): {
  message: string;
  confirm: string;
  now: string;
  cancel: string;
} {
  return QUIT_COPY[locale] ?? QUIT_COPY.en;
}

async function readUiLocale(): Promise<string> {
  if (!daemon?.alive) return "en";
  try {
    const raw = await daemonRpc(daemon, "app_settings_get", {}, 10_000);
    if (typeof raw !== "object" || raw === null) return "en";
    const settings = (raw as { settings?: { ui?: { locale?: unknown } } }).settings;
    const locale = settings?.ui?.locale;
    return typeof locale === "string" && locale.trim() ? locale.trim() : "en";
  } catch {
    return "en";
  }
}

async function anyVaultSessionOpen(): Promise<boolean> {
  if (!daemon?.alive) return false;
  try {
    const raw = await daemonRpc(daemon, "vault_list", {}, 10_000);
    if (typeof raw !== "object" || raw === null) return false;
    const vaults = (raw as { vaults?: unknown }).vaults;
    if (!Array.isArray(vaults)) return false;
    return vaults.some((item) => {
      if (typeof item !== "object" || item === null) return false;
      const session = (item as { session?: unknown }).session;
      return session === "open" || session === "closing";
    });
  } catch {
    return false;
  }
}

async function confirmQuitIfVaultsOpen(): Promise<QuitChoice> {
  if (!(await anyVaultSessionOpen())) return "flush";
  const copy = quitCopyForLocale(await readUiLocale());
  const options: Electron.MessageBoxOptions = {
    type: "warning",
    buttons: [copy.confirm, copy.now, copy.cancel],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    message: copy.message,
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
  await gracefulShutdown(0, choice === "flush");
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

  hardenProductionWindow(mainWindow);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = isDev ? "http://localhost:1420" : "file://";
    if (!url.startsWith(allowed)) event.preventDefault();
  });

  if (isDev) {
    await mainWindow.loadURL("http://localhost:1420");
    if (openDevTools) {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    if (quitPrompting) return;
    quitPrompting = true;
    void (async () => {
      try {
        await quitFromChoice(await confirmQuitIfVaultsOpen());
      } finally {
        quitPrompting = false;
      }
    })();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.handle("upriv-read-dropped", async (_event, paths: unknown) => {
  return readDroppedImportPaths(paths);
});

ipcMain.handle("upriv-stat-dropped", async (_event, paths: unknown) => {
  return statDroppedImportPaths(paths);
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

ipcMain.handle(
  "upriv-invoke",
  async (_event, method: string, params: Record<string, unknown>, timeoutMs?: number) => {
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

    if (method === "pick_save_file") {
      const title =
        typeof params?.title === "string" && params.title.trim() ? params.title.trim() : undefined;
      const defaultPath =
        typeof params?.defaultPath === "string" && params.defaultPath.trim()
          ? params.defaultPath.trim()
          : undefined;
      const filters = parseOpenDialogFilters(params?.filters);
      const options: Electron.SaveDialogOptions = {
        ...(title ? { title } : {}),
        ...(defaultPath ? { defaultPath } : {}),
        ...(filters ? { filters } : {}),
      };
      const result = mainWindow
        ? await dialog.showSaveDialog(mainWindow, options)
        : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) {
        return null;
      }
      return result.filePath;
    }

    if (method === "reveal_in_file_manager") {
      const osPath = await resolveVaultMountOsPath(params, finiteTimeoutMs(timeoutMs));
      await revealOsPathInFileManager(osPath, fs, shell);
      return null;
    }

    if (method === "open_in_terminal") {
      const osPath = await resolveVaultMountOsPath(params, finiteTimeoutMs(timeoutMs));
      await openOsPathInTerminal(osPath, fs, createDefaultTerminalHost());
      return null;
    }

    const activeDaemon = await ensureDaemon();
    return daemonRpc(activeDaemon, method, params, finiteTimeoutMs(timeoutMs));
  },
);

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

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
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
      const choice = await confirmQuitIfVaultsOpen();
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

if (isDev) {
  const gracefulDevExit = (): void => {
    if (!quitting) void gracefulShutdown(0);
  };
  process.on("SIGINT", gracefulDevExit);
  process.on("SIGTERM", gracefulDevExit);
}

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
