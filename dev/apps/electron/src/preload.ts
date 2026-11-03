import { contextBridge, ipcRenderer, webUtils } from "electron";
// Type only: a sandboxed preload cannot load local modules at runtime.
import type { InvokeReply } from "./daemonProtocol";

export interface UprivDesktopApi {
  /**
   * @param timeoutMs Daemon RPC timeout in main. `undefined` → `DEFAULT_RPC_TIMEOUT_MS`.
   * `0` → no timeout (a job, a close, or a dialog). Renderer should pass `METHOD_TIMEOUT_MS[method]`.
   * A failed call rejects with an `Error` whose message is the wire `code: message`.
   */
  invoke(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
  onEvent(callback: (name: string, payload: unknown) => void): () => void;
  /**
   * Absolute path of an OS-dropped `File`.
   * Renderer passes a DOM `File`; typed as `object` because Electron main `tsconfig` has no DOM lib.
   * Backed by `webUtils.getPathForFile`.
   */
  getPathForFile(file: object): string | undefined;
  /**
   * Read user-dropped OS files/folders from absolute paths (folders walked in RAM).
   */
  readDroppedPaths(paths: string[]): Promise<
    | { relativePath: string; contentB64: string }[]
    | {
        files: { relativePath: string; contentB64: string }[];
        truncated: boolean;
        symlinks?: string[];
      }
  >;
  /** `lstat` of one dropped path: file, directory, or anything else (including missing). */
  classifyDroppedPath(osPath: string): Promise<"file" | "directory" | "other">;
  statDroppedPaths(paths: string[]): Promise<
    | { relativePath: string; osPath: string; size: number }[]
    | {
        files: { relativePath: string; osPath: string; size: number }[];
        unreadable: string[];
        truncated?: boolean;
        symlinks?: string[];
      }
  >;
  readDroppedPathRange(
    osPath: string,
    offset: number,
    len: number,
  ): Promise<{ contentB64: string }>;
  /** Resolve an XDG FileTransfer portal key from a GTK4/Nautilus drop. */
  retrievePortalDrop(key: string): Promise<string[]>;
  /**
   * Logical processors on this computer. `0` when the shell did not answer,
   * so the caller can fall back to `navigator.hardwareConcurrency`.
   */
  logicalProcessors(): number;
  /**
   * The running jobs and closing vaults, sent whenever they change. Main asks
   * before quitting, waits for the jobs, and keeps the computer awake.
   */
  reportWork(report: { jobs: number; closing: number }): void;
  /** Close now from the quit overlay. */
  quitNow(): void;
}

const api: UprivDesktopApi = {
  async invoke(method, params, timeoutMs) {
    const reply = (await ipcRenderer.invoke(
      "upriv-invoke",
      method,
      params ?? {},
      timeoutMs,
    )) as InvokeReply;
    if (!reply.ok) throw new Error(reply.error);
    return reply.value;
  },
  onEvent(callback) {
    const listener = (_event: Electron.IpcRendererEvent, name: string, payload: unknown) => {
      callback(name, payload);
    };
    ipcRenderer.on("upriv-event", listener);
    return () => ipcRenderer.removeListener("upriv-event", listener);
  },
  getPathForFile(file) {
    try {
      const path = webUtils
        .getPathForFile(file as Parameters<typeof webUtils.getPathForFile>[0])
        ?.trim();
      return path || undefined;
    } catch {
      return undefined;
    }
  },
  readDroppedPaths(paths) {
    return ipcRenderer.invoke("upriv-read-dropped", paths);
  },
  classifyDroppedPath(osPath) {
    return ipcRenderer.invoke("upriv-classify-dropped", osPath);
  },
  statDroppedPaths(paths) {
    return ipcRenderer.invoke("upriv-stat-dropped", paths);
  },
  readDroppedPathRange(osPath, offset, len) {
    return ipcRenderer.invoke("upriv-read-dropped-range", osPath, offset, len);
  },
  retrievePortalDrop(key) {
    return ipcRenderer.invoke("upriv-retrieve-portal-drop", key);
  },
  logicalProcessors() {
    try {
      const count: unknown = ipcRenderer.sendSync("upriv-logical-processors");
      if (typeof count === "number" && Number.isFinite(count) && count >= 1) {
        return Math.floor(count);
      }
    } catch {
      // Older shells have no handler. The renderer falls back.
    }
    return 0;
  },
  reportWork(report) {
    ipcRenderer.send("upriv-work", report);
  },
  quitNow() {
    ipcRenderer.send("upriv-quit-now");
  },
};

contextBridge.exposeInMainWorld("upriv", api);
