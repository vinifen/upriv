import { describe, expect, it } from "vitest";
import { vaultRowFixture } from "../../vault/tests/fixtures.shared";
import { vaultRowControls, vaultSettingsMenuAreas, type VaultRowControls } from "../areas";
import type { VaultPipelineListStatus } from "../../vault/types";

describe("vaultSettingsMenuAreas", () => {
  it("includes password and unlock RAM for a closed vault of either mode", () => {
    const areas = ["preferences", "password", "kdf", "group"] as const;
    expect(vaultSettingsMenuAreas(vaultRowFixture())).toEqual(areas);
    expect(vaultSettingsMenuAreas(vaultRowFixture({ storageMode: "upriv_plain" }))).toEqual(areas);
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
    expect(vaultSettingsMenuAreas(vaultRowFixture(), { openingVaultIds: ["demo"] })).toEqual(
      preferencesAndGroup,
    );
    expect(vaultSettingsMenuAreas(vaultRowFixture(), { exportingVaultIds: ["demo"] })).toEqual(
      preferencesAndGroup,
    );
  });

  it("keeps the in-progress password or unlock RAM entry so that screen can reopen", () => {
    expect(vaultSettingsMenuAreas(vaultRowFixture(), { passwordChangeVaultIds: ["demo"] })).toEqual(
      ["preferences", "password", "group"],
    );
    expect(vaultSettingsMenuAreas(vaultRowFixture(), { kdfChangeVaultIds: ["demo"] })).toEqual([
      "preferences",
      "kdf",
      "group",
    ]);
    expect(
      vaultSettingsMenuAreas(vaultRowFixture({ storageMode: "upriv_plain" }), {
        passwordChangeVaultIds: ["demo"],
      }),
    ).toEqual(["preferences", "password", "group"]);
  });
});

describe("vaultRowControls", () => {
  const idle: VaultRowControls = {
    moreMenuBlocked: false,
    noteBlocked: false,
    noteHidden: false,
    settingsGearBlocked: false,
    settingsSaveBlocked: false,
    dragBlocked: false,
  };
  // The whole menu is closed: Note stays listed, greyed with the rest.
  const pipelineBusy: VaultRowControls = {
    moreMenuBlocked: true,
    noteBlocked: true,
    noteHidden: false,
    settingsGearBlocked: true,
    settingsSaveBlocked: true,
    dragBlocked: true,
  };

  function controls(pipeline: VaultPipelineListStatus = {}): VaultRowControls {
    return vaultRowControls(vaultRowFixture(), pipeline);
  }

  it("leaves a closed, open, or recovery vault fully usable", () => {
    expect(controls()).toEqual(idle);
    expect(vaultRowControls(vaultRowFixture({ session: "open" }))).toEqual(idle);
    expect(vaultRowControls(vaultRowFixture({ session: "recovery" }))).toEqual(idle);
  });

  it("closes every control while opening, creating, or queued", () => {
    expect(controls({ openingVaultIds: ["demo"] })).toEqual(pipelineBusy);
    expect(controls({ creatingVaultIds: ["demo"] })).toEqual(pipelineBusy);
    expect(controls({ queuedVaultIds: ["demo"] })).toEqual(pipelineBusy);
  });

  it("keeps the more menu and note during close, and closes the gear, save, and drag", () => {
    expect(controls({ closingVaultIds: ["demo"] })).toEqual({
      ...pipelineBusy,
      moreMenuBlocked: false,
      noteBlocked: false,
    });
  });

  it("keeps the more menu during export or a backup, leaves Note out, and closes gear, save, and drag", () => {
    const holding: VaultRowControls = {
      ...idle,
      noteBlocked: true,
      noteHidden: true,
      settingsGearBlocked: true,
      settingsSaveBlocked: true,
      dragBlocked: true,
    };
    expect(controls({ exportingVaultIds: ["demo"] })).toEqual(holding);
    expect(controls({ backupJobVaultIds: ["demo"] })).toEqual(holding);
  });

  it("keeps the gear open during a password or unlock-RAM change so that countdown can reopen", () => {
    const rewrap: VaultRowControls = {
      ...idle,
      noteBlocked: true,
      noteHidden: true,
      settingsSaveBlocked: true,
      dragBlocked: true,
    };
    expect(controls({ passwordChangeVaultIds: ["demo"] })).toEqual(rewrap);
    expect(controls({ kdfChangeVaultIds: ["demo"] })).toEqual(rewrap);
  });
});
