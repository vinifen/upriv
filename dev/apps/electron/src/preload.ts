import { contextBridge, ipcRenderer, webUtils } from "electron";

export interface UprivDesktopApi {
  /**
   * @param timeoutMs Daemon RPC timeout in main. `undefined` → Electron default (30s).
   * `0` → no timeout (native dialogs). Renderer should pass `METHOD_TIMEOUT_MS[method]`.
   */
  invoke(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
  onEvent(callback: (name: string, payload: unknown) => void): () => void;
  /**
   * Absolute path of an OS-dropped `File`.
   * Renderer passes a DOM `File`; typed as `object` because Electron main `tsconfig` has no DOM lib.
   * Electron 32+ removed `File.path`; `webUtils.getPathForFile` is the replacement.
   */
  getPathForFile(file: object): string | undefined;
  /**
   * Read user-dropped OS files/folders from absolute paths (folders walked in RAM).
   */
  readDroppedPaths(
    paths: string[],
  ): Promise<
    | { relativePath: string; contentB64: string }[]
    | { files: { relativePath: string; contentB64: string }[]; truncated: boolean }
  >;
  statDroppedPaths(paths: string[]): Promise<
    | { relativePath: string; osPath: string; size: number }[]
    | {
        files: { relativePath: string; osPath: string; size: number }[];
        unreadable: string[];
        truncated?: boolean;
      }
  >;
  readDroppedPathRange(
    osPath: string,
    offset: number,
    len: number,
  ): Promise<{ contentB64: string }>;
  /** Resolve an XDG FileTransfer portal key from a GTK4/Nautilus drop. */
  retrievePortalDrop(key: string): Promise<string[]>;
}

const api: UprivDesktopApi = {
  invoke(method, params, timeoutMs) {
    return ipcRenderer.invoke("upriv-invoke", method, params ?? {}, timeoutMs);
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
  statDroppedPaths(paths) {
    return ipcRenderer.invoke("upriv-stat-dropped", paths);
  },
  readDroppedPathRange(osPath, offset, len) {
    return ipcRenderer.invoke("upriv-read-dropped-range", osPath, offset, len);
  },
  retrievePortalDrop(key) {
    return ipcRenderer.invoke("upriv-retrieve-portal-drop", key);
  },
};

contextBridge.exposeInMainWorld("upriv", api);
