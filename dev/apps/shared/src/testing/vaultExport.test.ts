import { describe, expect, it } from "vitest";
import { vaultListItemFixture } from "../domain/vault-list/tests/fixtures";
import { mockVaultExportBytes } from "./vaultExport";

describe("mockVaultExportBytes", () => {
  it("encodes a lone surrogate instead of throwing", () => {
    const vault = vaultListItemFixture({ id: "demo", displayName: "Fotos \uD83D" });
    expect(() => mockVaultExportBytes(vault, { format: "store_zip" })).not.toThrow();
  });

  it("uses zip vs 7z magics", () => {
    const vault = vaultListItemFixture({ id: "demo", displayName: "Demo" });
    const zip = mockVaultExportBytes(vault, { format: "store_zip" });
    const seven = mockVaultExportBytes(vault, { format: "seven_zip" });
    expect([...zip.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect([...seven.slice(0, 2)]).toEqual([0x37, 0x7a]);
    expect(zip).not.toEqual(seven);
  });
});
