declare global {
  interface Window {
    upriv?: {
      invoke(
        method: string,
        params?: Record<string, unknown>,
        timeoutMs?: number,
      ): Promise<unknown>;
      onEvent(callback: (name: string, payload: unknown) => void): () => void;
    };
  }
}

export {};
