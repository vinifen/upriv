import { errorDisplayI18nKey, isRpcError } from "@upriv/shared";
import {
  createVaultErrorI18nKey as sharedCreateVaultErrorI18nKey,
  type CreateVaultValidationCode,
} from "@upriv/shared";
import type { I18nKey } from "@/i18n";
import { BRIDGE_ERROR_CODES, type BridgeErrorCode } from "./errors";

/** User-facing: maps desktop bridge wire codes → i18n keys. Keep in sync with `locales/*.json`. */
export const BRIDGE_ERROR_I18N_KEYS = {
  [BRIDGE_ERROR_CODES.DAEMON_UNAVAILABLE]: "error.service_unavailable",
  [BRIDGE_ERROR_CODES.BRIDGE_INVOKE_FAILED]: "error.bridge_invoke_failed",
  [BRIDGE_ERROR_CODES.RPC_TIMEOUT]: "error.operation_timed_out",
  [BRIDGE_ERROR_CODES.INVALID_RESPONSE]: "error.unexpected",
  [BRIDGE_ERROR_CODES.SHELL_UNAVAILABLE]: "error.service_unavailable",
} as const satisfies Record<BridgeErrorCode, I18nKey>;

export type BridgeErrorI18nKey = (typeof BRIDGE_ERROR_I18N_KEYS)[BridgeErrorCode];

function bridgeErrorI18nKey(code: string): BridgeErrorI18nKey | null {
  if (!(code in BRIDGE_ERROR_I18N_KEYS)) return null;
  return BRIDGE_ERROR_I18N_KEYS[code as BridgeErrorCode];
}

/**
 * Desktop UI: caught error → i18n key (shared domain + bridge).
 * Use `fallback` when the error is internal or unknown (e.g. `unknown_method`).
 * Vault-root setup timeouts use a dedicated message (operations can take minutes).
 */
export function desktopErrorI18nKey(
  error: unknown,
  fallback: I18nKey = "error.unexpected",
): I18nKey {
  if (
    isRpcError(error) &&
    error.code === BRIDGE_ERROR_CODES.RPC_TIMEOUT &&
    (fallback === "modal.vault_root_setup.error_init" ||
      fallback.startsWith("modal.vault_root_setup."))
  ) {
    return "modal.vault_root_setup.error_timeout";
  }
  const key =
    errorDisplayI18nKey(error) ?? (isRpcError(error) ? bridgeErrorI18nKey(error.code) : null);
  return key ?? fallback;
}

/** Typed i18n key for create-vault / change-password validation codes. */
export function createVaultErrorI18nKey(code: CreateVaultValidationCode): I18nKey {
  return sharedCreateVaultErrorI18nKey(code);
}
