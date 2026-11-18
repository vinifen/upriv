import { describe, expect, it } from "vitest";
import { vaultRowFixture } from "../../vault/tests/fixtures.shared";
import { rebaseQuietLockedVaultSettings } from "../rebaseQuiet";
import { vaultSettingsFixture } from "./fixtures";

const baseline = vaultSettingsFixture({
  vault: { id: "notes", display_name: "Notes" },
});

function draftWith(displayName: string, note: string) {
  return {
    ...baseline,
    vault: { ...baseline.vault, display_name: displayName, note },
    unlocked_folder: { ...baseline.unlocked_folder, encrypted: "on" as const },
  };
}

describe("rebaseQuietLockedVaultSettings", () => {
  it("keeps quiet dirty when vault is quiet", () => {
    const closed = vaultRowFixture({ id: "notes" });
    const draft = draftWith("Renamed", "x");
    expect(rebaseQuietLockedVaultSettings(draft, baseline, closed)).toEqual(draft);
  });

  it("rebases quiet fields to baseline when open, keeps anytime", () => {
    const open = vaultRowFixture({ id: "notes", session: "open" });
    const rebased = rebaseQuietLockedVaultSettings(draftWith("Renamed", "keep"), baseline, open);
    expect(rebased.vault.display_name).toBe("Notes");
    expect(rebased.vault.note).toBe("keep");
    expect(rebased.unlocked_folder.encrypted).toBe(baseline.unlocked_folder.encrypted);
  });

  it("rebases display_name when creating, keeps vault_quiet dirty", () => {
    const closed = vaultRowFixture({ id: "notes" });
    const rebased = rebaseQuietLockedVaultSettings(draftWith("Renamed", "keep"), baseline, closed, {
      creatingVaultIds: ["notes"],
    });
    expect(rebased.vault.display_name).toBe("Notes");
    expect(rebased.vault.note).toBe("keep");
    expect(rebased.unlocked_folder.encrypted).toBe("on");
  });

  it("passes the storage value through as it is: a save never changes it", () => {
    const open = vaultRowFixture({ id: "notes", session: "open" });
    const draft = {
      ...baseline,
      storage: { mode: "upriv_plain" as const, plain_files: "whole" as const },
    };
    expect(rebaseQuietLockedVaultSettings(draft, baseline, open).storage).toEqual(draft.storage);
  });
});
