import { describe, expect, it } from "vitest";
import { RpcError } from "../../core-rpc/errors";
import { errorDisplayI18nKey } from "../display";

describe("errorDisplayI18nKey", () => {
  it("maps log_file_too_large to the logs toast key", () => {
    expect(errorDisplayI18nKey(new RpcError("log_file_too_large", "too big"))).toBe(
      "toast.logs_file_too_large",
    );
  });

  it("maps internal_error to the generic internal key", () => {
    expect(errorDisplayI18nKey(new RpcError("internal_error", "panic"))).toBe("error.internal");
    expect(errorDisplayI18nKey(new RpcError("not_implemented", "stub"))).toBe(
      "error.not_implemented",
    );
    expect(errorDisplayI18nKey(new RpcError("vault_rewrap_unavailable", "p0"))).toBe(
      "error.vault_rewrap_unavailable",
    );
    expect(errorDisplayI18nKey(new RpcError("vault_saf_unavailable", "saf"))).toBe(
      "error.vault_saf_unavailable",
    );
    expect(errorDisplayI18nKey(new RpcError("upriv_plain_unavailable", "plain"))).toBe(
      "error.upriv_plain_unavailable",
    );
  });

  it("maps vault-root A/B codes and transport io_error", () => {
    expect(errorDisplayI18nKey(new RpcError("vault_root_not_found", "gone"))).toBe(
      "modal.vault_root_setup.lost",
    );
    expect(errorDisplayI18nKey(new RpcError("io_error", "disk"))).toBe(
      "modal.vault_root_setup.error_io",
    );
  });

  it("maps insufficient_ram to the unlock-preset RAM key", () => {
    expect(errorDisplayI18nKey(new RpcError("insufficient_ram", "oom"))).toBe(
      "error.insufficient_ram",
    );
  });

  it("maps vault_root_busy to the data-folder activity key", () => {
    expect(errorDisplayI18nKey(new RpcError("vault_root_busy", "sessions"))).toBe(
      "modal.data_folder.blocked_vault_activity",
    );
  });

  it("maps vault_config_busy to the settings busy key", () => {
    expect(errorDisplayI18nKey(new RpcError("vault_config_busy", "quiet"))).toBe(
      "error.vault_config_busy",
    );
  });

  it("returns null for unknown errors", () => {
    expect(errorDisplayI18nKey(new Error("nope"))).toBeNull();
  });
});
