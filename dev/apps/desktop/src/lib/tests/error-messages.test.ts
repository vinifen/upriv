import { describe, expect, it } from "vitest";
import { BRIDGE_ERROR_CODES, RpcError } from "../errors";
import { desktopErrorI18nKey } from "../errorMessages";

describe("desktopErrorI18nKey", () => {
  it("maps bridge codes to i18n keys", () => {
    expect(desktopErrorI18nKey(new RpcError(BRIDGE_ERROR_CODES.DAEMON_UNAVAILABLE, "down"))).toBe(
      "error.service_unavailable",
    );
    expect(desktopErrorI18nKey(new RpcError(BRIDGE_ERROR_CODES.RPC_TIMEOUT, "slow"))).toBe(
      "error.operation_timed_out",
    );
    expect(desktopErrorI18nKey(new RpcError(BRIDGE_ERROR_CODES.BRIDGE_INVOKE_FAILED, "ipc"))).toBe(
      "error.bridge_invoke_failed",
    );
  });

  it("uses vault-root timeout copy when fallback is a setup key", () => {
    expect(
      desktopErrorI18nKey(
        new RpcError(BRIDGE_ERROR_CODES.RPC_TIMEOUT, "slow"),
        "modal.vault_root_setup.error_init",
      ),
    ).toBe("modal.vault_root_setup.error_timeout");
  });

  it("returns fallback for unknown errors", () => {
    expect(desktopErrorI18nKey(new Error("boom"), "error.settings_save_failed")).toBe(
      "error.settings_save_failed",
    );
    expect(desktopErrorI18nKey("string")).toBe("error.unexpected");
  });

  it("maps vault-root setup timeouts for any setup fallback key", () => {
    expect(
      desktopErrorI18nKey(
        new RpcError(BRIDGE_ERROR_CODES.RPC_TIMEOUT, "slow"),
        "modal.vault_root_setup.error_pick",
      ),
    ).toBe("modal.vault_root_setup.error_timeout");
  });
});
