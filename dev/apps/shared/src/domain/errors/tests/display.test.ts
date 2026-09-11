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
  });

  it("maps vault-root A/B codes and transport io_error", () => {
    expect(errorDisplayI18nKey(new RpcError("vault_root_not_found", "gone"))).toBe(
      "modal.vault_root_setup.lost",
    );
    expect(errorDisplayI18nKey(new RpcError("io_error", "disk"))).toBe(
      "modal.vault_root_setup.error_io",
    );
  });

  it("returns null for unknown errors", () => {
    expect(errorDisplayI18nKey(new Error("nope"))).toBeNull();
  });
});
