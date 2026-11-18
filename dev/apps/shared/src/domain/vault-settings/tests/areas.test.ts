import { describe, expect, it } from "vitest";
import { vaultRowFixture } from "../../vault/tests/fixtures.shared";
import { vaultRowControls, vaultSettingsMenuEntries, type VaultRowControls } from "../areas";
import type { VaultPipelineListStatus } from "../../vault/types";

describe("vaultSettingsMenuEntries", () => {
  it("lists every settings screen, then Delete vault, for a closed vault of either mode", () => {
    const areas = ["preferences", "password", "kdf", "storage", "group", "delete"] as const;
    expect(vaultSettingsMenuEntries(vaultRowFixture())).toEqual(areas);
    expect(vaultSettingsMenuEntries(vaultRowFixture({ storageMode: "upriv_plain" }))).toEqual(
      areas,
    );
  });

  it("offers the Delete vault window alone while a delete runs or did not finish", () => {
    expect(vaultSettingsMenuEntries(vaultRowFixture({ session: "deleting" }))).toEqual(["delete"]);
    expect(vaultSettingsMenuEntries(vaultRowFixture(), { deletingVaultIds: ["demo"] })).toEqual([
      "delete",
    ]);
  });

  it("omits password, unlock RAM, and Storage when the vault is not strictly closed", () => {
    const preferencesAndGroup = ["preferences", "group", "delete"];
    expect(vaultSettingsMenuEntries(vaultRowFixture({ session: "open" }))).toEqual(
      preferencesAndGroup,
    );
    expect(vaultSettingsMenuEntries(vaultRowFixture({ session: "recovery" }))).toEqual(
      preferencesAndGroup,
    );
    expect(vaultSettingsMenuEntries(vaultRowFixture({ session: "closing" }))).toEqual(
      preferencesAndGroup,
    );
    expect(vaultSettingsMenuEntries(vaultRowFixture(), { openingVaultIds: ["demo"] })).toEqual(
      preferencesAndGroup,
    );
    expect(vaultSettingsMenuEntries(vaultRowFixture(), { exportingVaultIds: ["demo"] })).toEqual(
      preferencesAndGroup,
    );
  });

  it("keeps the change in progress in the menu so that screen can reopen", () => {
    expect(
      vaultSettingsMenuEntries(vaultRowFixture(), { storageChangeVaultIds: ["demo"] }),
    ).toEqual(["preferences", "storage", "group", "delete"]);
    expect(
      vaultSettingsMenuEntries(vaultRowFixture(), { passwordChangeVaultIds: ["demo"] }),
    ).toEqual(["preferences", "password", "group", "delete"]);
    expect(vaultSettingsMenuEntries(vaultRowFixture(), { kdfChangeVaultIds: ["demo"] })).toEqual([
      "preferences",
      "kdf",
      "group",
      "delete",
    ]);
    expect(
      vaultSettingsMenuEntries(vaultRowFixture({ storageMode: "upriv_plain" }), {
        passwordChangeVaultIds: ["demo"],
      }),
    ).toEqual(["preferences", "password", "group", "delete"]);
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

  it("keeps the gear and the menu open during a change or a delete so its window can reopen", () => {
    const working: VaultRowControls = {
      ...idle,
      noteBlocked: true,
      noteHidden: true,
      settingsSaveBlocked: true,
      dragBlocked: true,
    };
    expect(controls({ passwordChangeVaultIds: ["demo"] })).toEqual(working);
    expect(controls({ kdfChangeVaultIds: ["demo"] })).toEqual(working);
    expect(controls({ storageChangeVaultIds: ["demo"] })).toEqual(working);
    expect(controls({ deletingVaultIds: ["demo"] })).toEqual(working);
  });
});
