import { describe, expect, it } from "vitest";
import { RpcError } from "../../core-rpc/errors";
import {
  VAULT_ROOT_ERROR_CODES,
  isVaultRootErrorCode,
  isVaultRootGoneError,
  shouldBumpVaultRootEpoch,
  vaultRootGoneRpcError,
} from "../errors";

describe("shouldBumpVaultRootEpoch", () => {
  it("bumps the Gate for a missing, incomplete, or unreadable data folder or list", () => {
    for (const code of [
      VAULT_ROOT_ERROR_CODES.NOT_FOUND,
      VAULT_ROOT_ERROR_CODES.INCOMPLETE,
      VAULT_ROOT_ERROR_CODES.LIST_INVALID,
      VAULT_ROOT_ERROR_CODES.UNREACHABLE,
      "saf_unauthorized",
      "saf_invalid_tree",
    ]) {
      expect(shouldBumpVaultRootEpoch(new RpcError(code, code)), code).toBe(true);
    }
  });

  it("does not bump for vault-layer, transport, or busy errors", () => {
    for (const code of [
      "vault_not_found",
      "wrong_password",
      VAULT_ROOT_ERROR_CODES.IO_ERROR,
      VAULT_ROOT_ERROR_CODES.BUSY,
      VAULT_ROOT_ERROR_CODES.UNAVAILABLE,
    ]) {
      expect(shouldBumpVaultRootEpoch(new RpcError(code, code)), code).toBe(false);
    }
    expect(shouldBumpVaultRootEpoch(new Error("boom"))).toBe(false);
    expect(isVaultRootErrorCode(VAULT_ROOT_ERROR_CODES.UNREACHABLE)).toBe(false);
  });
});

describe("isVaultRootGoneError", () => {
  it("is true when the data folder in use is gone or its grant is lost", () => {
    expect(isVaultRootGoneError(vaultRootGoneRpcError())).toBe(true);
    expect(isVaultRootGoneError(new RpcError("saf_unauthorized", "grant"))).toBe(true);
  });

  it("is false for an incomplete data folder, an unreachable one, and other errors", () => {
    expect(isVaultRootGoneError(new RpcError(VAULT_ROOT_ERROR_CODES.INCOMPLETE, "x"))).toBe(false);
    expect(isVaultRootGoneError(new RpcError(VAULT_ROOT_ERROR_CODES.UNREACHABLE, "x"))).toBe(false);
    expect(isVaultRootGoneError(new Error("x"))).toBe(false);
  });
});
