declare global {
  interface Window {
    upriv?: {
      invoke(method: string, params?: Record<string, unknown>): Promise<unknown>;
      onEvent(callback: (name: string, payload: unknown) => void): () => void;
    };
  }
}

export {};
