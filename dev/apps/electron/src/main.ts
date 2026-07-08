import path from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
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

let mainWindow: BrowserWindow | null = null;
let daemon: DaemonConnection | null = null;
let daemonStarting: Promise<DaemonConnection> | null = null;
let stopEvents: (() => void) | null = null;
let quitting = false;

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

  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    title: "Upriv",
    autoHideMenuBar: !isDev,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

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

    const activeDaemon = await ensureDaemon();
    return daemonRpc(activeDaemon, method, params);
  },
);

const gotSingleInstanceLock = app.requestSingleInstanceLock();
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
