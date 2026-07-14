/** Wire error envelope from upriv-daemon (`rpc.rs` → `RpcResponse.error`). */
export interface RpcErrorBody {
  code: string;
  /** English — for logs and dev. UI must map `code` via domain error message maps (e.g. `vault/errors/messages.ts`). */
  message: string;
  details?: unknown;
}

/** Structured error on the client. `message` is English (log/dev); user UI uses i18n keys. */
export class RpcError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.details = details;
  }
}

/** RPC routing / wire errors from upriv-daemon. Keep in sync with `rpc.rs`. */
export const RPC_PROTOCOL_ERROR_CODES = {
  UNKNOWN_METHOD: "unknown_method",
} as const;

export type RpcProtocolErrorCode =
  (typeof RPC_PROTOCOL_ERROR_CODES)[keyof typeof RPC_PROTOCOL_ERROR_CODES];

/**
 * Duck-typed: Vite may load `@upriv/shared` more than once, so `instanceof RpcError` is unreliable.
 */
export function isRpcError(error: unknown): error is RpcError {
  if (typeof error !== "object" || error === null) return false;
  const record = error as { name?: unknown; code?: unknown; message?: unknown };
  return (
    record.name === "RpcError" &&
    typeof record.code === "string" &&
    typeof record.message === "string"
  );
}

export function isRpcErrorBody(value: unknown): value is RpcErrorBody {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.code === "string" && typeof record.message === "string";
}

export function parseRpcErrorBody(value: unknown): RpcErrorBody | null {
  return isRpcErrorBody(value) ? value : null;
}
