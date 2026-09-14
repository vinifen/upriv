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
  it("bumps Gate for vault-root A/B codes", () => {
    expect(shouldBumpVaultRootEpoch(new RpcError(VAULT_ROOT_ERROR_CODES.NOT_FOUND, "gone"))).toBe(
      true,
    );
    expect(
      shouldBumpVaultRootEpoch(new RpcError(VAULT_ROOT_ERROR_CODES.INCOMPLETE, "broken")),
    ).toBe(true);
    expect(
      shouldBumpVaultRootEpoch(new RpcError(VAULT_ROOT_ERROR_CODES.ALIAS_INVALID, "alias")),
    ).toBe(true);
  });

  it("does not bump for vault-layer or unknown errors", () => {
    expect(shouldBumpVaultRootEpoch(new RpcError("vault_not_found", "missing vault"))).toBe(false);
    expect(shouldBumpVaultRootEpoch(new RpcError("wrong_password", "nope"))).toBe(false);
    expect(shouldBumpVaultRootEpoch(new RpcError(VAULT_ROOT_ERROR_CODES.IO_ERROR, "disk"))).toBe(
      false,
    );
    expect(shouldBumpVaultRootEpoch(new Error("boom"))).toBe(false);
    expect(isVaultRootErrorCode(VAULT_ROOT_ERROR_CODES.NOT_FOUND)).toBe(true);
    expect(isVaultRootErrorCode(VAULT_ROOT_ERROR_CODES.INCOMPLETE)).toBe(true);
    expect(isVaultRootErrorCode(VAULT_ROOT_ERROR_CODES.ALIAS_INVALID)).toBe(true);
    expect(isVaultRootErrorCode("vault_not_found")).toBe(false);
    expect(isVaultRootErrorCode(VAULT_ROOT_ERROR_CODES.IO_ERROR)).toBe(false);
    expect(isVaultRootErrorCode(VAULT_ROOT_ERROR_CODES.BUSY)).toBe(false);
    expect(shouldBumpVaultRootEpoch(new RpcError(VAULT_ROOT_ERROR_CODES.BUSY, "open"))).toBe(false);
  });

  it("bumps Gate for SAF lost-grant and write/create failures", () => {
    expect(shouldBumpVaultRootEpoch(new RpcError("saf_unauthorized", "grant gone"))).toBe(true);
    expect(shouldBumpVaultRootEpoch(new RpcError("saf_invalid_tree", "bad tree"))).toBe(true);
    expect(shouldBumpVaultRootEpoch(new RpcError("saf_write_failed", "write"))).toBe(true);
    expect(shouldBumpVaultRootEpoch(new RpcError("saf_create_failed", "create"))).toBe(true);
  });
});

describe("isVaultRootGoneError", () => {
  it("is true when the data folder is missing or the custom alias target is gone", () => {
    expect(isVaultRootGoneError(new RpcError(VAULT_ROOT_ERROR_CODES.NOT_FOUND, "gone"))).toBe(true);
    expect(isVaultRootGoneError(new RpcError(VAULT_ROOT_ERROR_CODES.ALIAS_INVALID, "alias"))).toBe(
      true,
    );
    expect(isVaultRootGoneError(new RpcError("saf_unauthorized", "grant gone"))).toBe(true);
    expect(isVaultRootGoneError(new RpcError("saf_invalid_tree", "bad tree"))).toBe(true);
  });

  it("is false for incomplete leftover, transport, and other layers", () => {
    expect(isVaultRootGoneError(new RpcError(VAULT_ROOT_ERROR_CODES.INCOMPLETE, "broken"))).toBe(
      false,
    );
    expect(isVaultRootGoneError(new RpcError(VAULT_ROOT_ERROR_CODES.IO_ERROR, "disk"))).toBe(false);
    expect(isVaultRootGoneError(new RpcError("saf_write_failed", "write"))).toBe(false);
    expect(isVaultRootGoneError(new RpcError("saf_create_failed", "create"))).toBe(false);
    expect(isVaultRootGoneError(new RpcError("vault_not_found", "missing vault"))).toBe(false);
    expect(isVaultRootGoneError(new Error("boom"))).toBe(false);
  });

  it("vaultRootGoneRpcError is a not_found wire error", () => {
    expect(vaultRootGoneRpcError()).toMatchObject({
      code: VAULT_ROOT_ERROR_CODES.NOT_FOUND,
    });
  });
});
