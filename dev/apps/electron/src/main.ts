import fs from "node:fs";
import path from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  session,
} from "electron";
import {
  connectDaemonEvents,
  daemonRpc,
  setDaemonExitHandler,
  startDaemon,
  stopDaemon,
  type DaemonConnection,
} from "./daemon";

const isDev =
  process.argv.includes("--dev") || process.env.UPRIV_DEV === "1";
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
    const reload =
      key === "f5" ||
      ((input.control || input.meta) && key === "r");
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
      dialog.showErrorBox(
        "Upriv",
        "The vault backend stopped unexpectedly. The app will close.",
      );
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

async function teardownDaemon(): Promise<void> {
  stopEvents?.();
  stopEvents = null;
  await stopDaemon(daemon);
  daemon = null;
  setDaemonExitHandler(null);
}

async function gracefulShutdown(exitCode = 0): Promise<void> {
  if (quitting) return;
  quitting = true;
  await teardownDaemon();
  app.exit(exitCode);
}

async function createWindow(): Promise<void> {
  await ensureDaemon();

  const iconPath = resolveWindowIcon();
  const iconImage = iconPath ? nativeImage.createFromPath(iconPath) : undefined;
  const icon =
    iconImage && !iconImage.isEmpty() ? iconImage : iconPath;

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

  if (isDev) {
    await mainWindow.loadURL("http://localhost:1420");
    if (openDevTools) {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.handle(
  "upriv-invoke",
  async (_event, method: string, params: Record<string, unknown>) => {
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
        typeof params?.title === "string" && params.title.trim()
          ? params.title.trim()
          : undefined;
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

    const activeDaemon = await ensureDaemon();
    return daemonRpc(activeDaemon, method, params);
  },
);

const gotSingleInstanceLock = app.requestSingleInstanceLock();
// Single-instance is the concurrency guard for vault-root mutations (setup / alias write).
// A second process only focuses the existing window — it does not run another daemon setup.
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
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
  void gracefulShutdown(0);
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
