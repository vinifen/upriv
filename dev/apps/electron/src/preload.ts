import { contextBridge, ipcRenderer } from "electron";

export interface UprivDesktopApi {
  invoke(method: string, params?: Record<string, unknown>): Promise<unknown>;
  onEvent(callback: (name: string, payload: unknown) => void): () => void;
}

const api: UprivDesktopApi = {
  invoke(method, params) {
    return ipcRenderer.invoke("upriv-invoke", method, params ?? {});
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
