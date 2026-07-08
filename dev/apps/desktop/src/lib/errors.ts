import {
  isRpcError,
  isRpcErrorBody,
  parseRpcErrorBody,
  RPC_PROTOCOL_ERROR_CODES,
  RpcError,
} from "@upriv/shared";

/** Desktop bridge / shell errors (not returned by Rust). */
export const BRIDGE_ERROR_CODES = {
  DAEMON_UNAVAILABLE: "daemon_unavailable",
  RPC_TIMEOUT: "rpc_timeout",
  INVALID_RESPONSE: "invalid_response",
  SHELL_UNAVAILABLE: "shell_unavailable",
} as const;

export type BridgeErrorCode = (typeof BRIDGE_ERROR_CODES)[keyof typeof BRIDGE_ERROR_CODES];

export type { RpcErrorBody } from "@upriv/shared";

export {
  RPC_PROTOCOL_ERROR_CODES,
  isRpcError,
  isRpcErrorBody,
  parseRpcErrorBody,
  RpcError,
};
