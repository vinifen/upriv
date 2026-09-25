declare global {
  interface Window {
    upriv?: {
      invoke(
        method: string,
        params?: Record<string, unknown>,
        timeoutMs?: number,
      ): Promise<unknown>;
      onEvent(callback: (name: string, payload: unknown) => void): () => void;
      /** Absolute path of an OS-dropped File (Electron 32+). */
      getPathForFile?(file: File): string | undefined;
      readDroppedPaths?(
        paths: string[],
      ): Promise<
        | { relativePath: string; contentB64: string }[]
        | { files: { relativePath: string; contentB64: string }[]; truncated: boolean }
      >;
      statDroppedPaths?(paths: string[]): Promise<
        | { relativePath: string; osPath: string; size: number }[]
        | {
            files: { relativePath: string; osPath: string; size: number }[];
            unreadable: string[];
            truncated?: boolean;
          }
      >;
      readDroppedPathRange?(
        osPath: string,
        offset: number,
        len: number,
      ): Promise<{ contentB64: string }>;
      retrievePortalDrop?(key: string): Promise<string[]>;
    };
  }
}

export {};
