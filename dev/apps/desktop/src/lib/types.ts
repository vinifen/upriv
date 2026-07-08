import { BRIDGE_ERROR_CODES, RpcError } from "./errors";

export interface AppVersionResult {
  version: string;
}

export function isAppVersionResult(value: unknown): value is AppVersionResult {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as AppVersionResult).version === "string"
  );
}

export function parseAppVersionResult(value: unknown): AppVersionResult {
  if (isAppVersionResult(value)) return value;
  throw new RpcError(
    BRIDGE_ERROR_CODES.INVALID_RESPONSE,
    "app_version: expected { version: string }",
    value,
  );
}
