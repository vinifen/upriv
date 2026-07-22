import { BRIDGE_ERROR_CODES, RpcError } from "./errors";
import type { AppDistribution } from "@upriv/shared";

export interface AppVersionResult {
  version: string;
  /** Present when daemon reports packaging mode. */
  distribution?: AppDistribution;
}

function isAppDistribution(value: unknown): value is AppDistribution {
  return value === "portable" || value === "installed" || value === "dev";
}

export function isAppVersionResult(value: unknown): value is AppVersionResult {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as AppVersionResult).version !== "string"
  ) {
    return false;
  }
  const distribution = (value as AppVersionResult).distribution;
  return distribution === undefined || isAppDistribution(distribution);
}

export function parseAppVersionResult(value: unknown): AppVersionResult {
  if (isAppVersionResult(value)) return value;
  throw new RpcError(
    BRIDGE_ERROR_CODES.INVALID_RESPONSE,
    "app_version: expected { version: string, distribution?: portable|installed|dev }",
    value,
  );
}
