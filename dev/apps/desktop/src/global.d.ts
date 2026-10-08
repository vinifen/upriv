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
      /** `lstat` of one dropped path. Missing paths and symlinks are `other`. */
      classifyDroppedPath?(osPath: string): Promise<"file" | "directory" | "other">;
      readDroppedPaths?(paths: string[]): Promise<
        | { relativePath: string; contentB64: string }[]
        | {
            files: { relativePath: string; contentB64: string }[];
            truncated: boolean;
            symlinks?: string[];
          }
      >;
      statDroppedPaths?(paths: string[]): Promise<
        | { relativePath: string; osPath: string; size: number }[]
        | {
            files: { relativePath: string; osPath: string; size: number }[];
            unreadable: string[];
            truncated?: boolean;
            symlinks?: string[];
          }
      >;
      readDroppedPathRange?(
        osPath: string,
        offset: number,
        len: number,
      ): Promise<{ contentB64: string }>;
      retrievePortalDrop?(key: string): Promise<string[]>;
      /** Logical processors. `0` or missing means use `navigator.hardwareConcurrency`. */
      logicalProcessors?(): number;
    };
  }
}

export {};
