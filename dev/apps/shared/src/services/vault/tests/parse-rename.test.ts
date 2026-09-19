import { describe, expect, it } from "vitest";
import { RpcError } from "../../../domain/core-rpc/errors";
import { parseVaultRenameResult } from "../parseRename";

describe("parseVaultRenameResult", () => {
  it("maps camelCase rename wire", () => {
    expect(
      parseVaultRenameResult({
        id: "work-docs",
        previousId: "notes",
        displayName: "Work Docs",
        idChanged: true,
      }),
    ).toEqual({
      id: "work-docs",
      previousId: "notes",
      displayName: "Work Docs",
      idChanged: true,
    });
  });

  it("rejects a missing field", () => {
    expect(() =>
      parseVaultRenameResult({
        id: "notes",
        previousId: "notes",
        displayName: "Notes",
      }),
    ).toThrow(RpcError);
  });
});
