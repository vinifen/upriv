import { RpcError, VAULT_ERROR_CODES } from "@upriv/shared";
import { safGetActiveUri } from "./safVaultRoot";

export function safVaultPathRpcUnavailable(): boolean {
  return Boolean(safGetActiveUri());
}

export function assertSafVaultPathRpcAvailable(): void {
  if (!safVaultPathRpcUnavailable()) return;
  throw new RpcError(
    VAULT_ERROR_CODES.SAF_UNAVAILABLE,
    "Vault path RPCs are unavailable while a SAF tree is the active vault-root",
  );
}
