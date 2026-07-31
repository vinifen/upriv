import { contextBridge, ipcRenderer } from "electron";

export interface UprivDesktopApi {
  /**
   * @param timeoutMs Daemon RPC timeout in main. `undefined` → Electron default (30s).
   * `0` → no timeout (native dialogs). Renderer should pass `METHOD_TIMEOUT_MS[method]`.
   */
  invoke(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<unknown>;
  onEvent(callback: (name: string, payload: unknown) => void): () => void;
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
};

contextBridge.exposeInMainWorld("upriv", api);
