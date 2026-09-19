import { RpcError } from "../../domain/core-rpc/errors";
import type { VaultRenameResult } from "./VaultService";

const INVALID_RESPONSE = "invalid_response";

/** Parse `vault_rename` camelCase wire into `VaultRenameResult`. */
export function parseVaultRenameResult(raw: unknown): VaultRenameResult {
  if (typeof raw !== "object" || raw === null) {
    throw new RpcError(INVALID_RESPONSE, "vault_rename: expected object", raw);
  }
  const result = raw as {
    id?: unknown;
    previousId?: unknown;
    displayName?: unknown;
    idChanged?: unknown;
  };
  if (
    typeof result.id !== "string" ||
    typeof result.previousId !== "string" ||
    typeof result.displayName !== "string" ||
    typeof result.idChanged !== "boolean"
  ) {
    throw new RpcError(
      INVALID_RESPONSE,
      "vault_rename: expected id/previousId/displayName/idChanged",
      raw,
    );
  }
  return {
    id: result.id,
    previousId: result.previousId,
    displayName: result.displayName,
    idChanged: result.idChanged,
  };
}
