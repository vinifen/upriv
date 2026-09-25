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
    expect(errorDisplayI18nKey(new RpcError("open_path_failed", "xdg-open"))).toBe(
      "modal.file_manager.toast.open_system_failed",
    );
    expect(errorDisplayI18nKey(new RpcError("open_terminal_failed", "no terminal"))).toBe(
      "modal.file_manager.toast.open_terminal_failed",
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
    expect(errorDisplayI18nKey(new RpcError("import_archive_not_found", "gone"))).toBe(
      "error.import_archive_not_found",
    );
    expect(errorDisplayI18nKey(new RpcError("import_source_unreadable", "gone"))).toBe(
      "error.import_source_unreadable",
    );
    expect(errorDisplayI18nKey(new RpcError("vault_must_be_closed", "open"))).toBe(
      "error.vault_must_be_closed",
    );
  });

  it("maps insufficient_ram to the unlock-preset RAM key", () => {
    expect(errorDisplayI18nKey(new RpcError("insufficient_ram", "oom"))).toBe(
      "error.insufficient_ram",
    );
    expect(errorDisplayI18nKey(new RpcError("insufficient_ram_export", "oom"))).toBe(
      "error.insufficient_ram_export",
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
