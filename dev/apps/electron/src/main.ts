import path from "node:path";
import { app, BrowserWindow, ipcMain, Menu } from "electron";
import {
  connectDaemonEvents,
  daemonRpc,
  startDaemon,
  stopDaemon,
  type DaemonConnection,
} from "./daemon";

const isDev = process.argv.includes("--dev") || !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let daemon: DaemonConnection | null = null;
let stopEvents: (() => void) | null = null;

async function createWindow(): Promise<void> {
  daemon = await startDaemon();
  stopEvents = connectDaemonEvents(daemon, (name, payload) => {
    mainWindow?.webContents.send("upriv-event", name, payload);
  });

  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    title: "Upriv",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    await mainWindow.loadURL("http://localhost:1420");
    mainWindow.webContents.openDevTools({ mode: "detach" });
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
      app.quit();
      return null;
    }
    if (!daemon) {
      throw new Error("upriv-daemon is not running");
    }
    return daemonRpc(daemon, method, params);
  },
);

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
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

app.on("before-quit", () => {
  stopEvents?.();
  stopEvents = null;
  stopDaemon(daemon);
  daemon = null;
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
