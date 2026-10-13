import { describe, expect, it } from "vitest";
import { vaultRowFixture } from "../../vault/tests/fixtures.shared";
import { vaultSettingsMenuAreas } from "../areas";

describe("vaultSettingsMenuAreas", () => {
  it("includes password and unlock RAM only for a closed encrypted vault", () => {
    expect(vaultSettingsMenuAreas(vaultRowFixture())).toEqual([
      "preferences",
      "password",
      "kdf",
      "group",
    ]);
  });

  it("omits both when the vault cannot rewrap", () => {
    const preferencesAndGroup = ["preferences", "group"];
    expect(vaultSettingsMenuAreas(vaultRowFixture({ session: "open" }))).toEqual(
      preferencesAndGroup,
    );
    expect(vaultSettingsMenuAreas(vaultRowFixture({ session: "recovery" }))).toEqual(
      preferencesAndGroup,
    );
    expect(vaultSettingsMenuAreas(vaultRowFixture({ session: "closing" }))).toEqual(
      preferencesAndGroup,
    );
    expect(vaultSettingsMenuAreas(vaultRowFixture({ storageMode: "upriv_plain" }))).toEqual(
      preferencesAndGroup,
    );
    expect(
      vaultSettingsMenuAreas(vaultRowFixture(), { openingVaultIds: ["demo"] }),
    ).toEqual(preferencesAndGroup);
    expect(
      vaultSettingsMenuAreas(vaultRowFixture(), { exportingVaultIds: ["demo"] }),
    ).toEqual(preferencesAndGroup);
    expect(
      vaultSettingsMenuAreas(vaultRowFixture(), { passwordChangeVaultIds: ["demo"] }),
    ).toEqual(preferencesAndGroup);
    expect(
      vaultSettingsMenuAreas(vaultRowFixture(), { kdfChangeVaultIds: ["demo"] }),
    ).toEqual(preferencesAndGroup);
  });
});
