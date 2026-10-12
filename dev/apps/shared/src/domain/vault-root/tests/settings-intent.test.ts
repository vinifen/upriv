import { describe, expect, it } from "vitest";
import {
  confirmNotesForReplacePolicy,
  diskFromDirStatus,
  isVaultRootDraftDirty,
  vaultRootDiskProblemKey,
  vaultRootDraftKey,
  vaultRootGateFromState,
  visibleVaultRootDisk,
} from "../settingsIntent";

describe("isVaultRootDraftDirty", () => {
  it("detects mode or path changes", () => {
    expect(isVaultRootDraftDirty("default_root", "/a", "default_root", "/a")).toBe(false);
    expect(isVaultRootDraftDirty("custom_root", "/a", "default_root", "/a")).toBe(true);
    expect(isVaultRootDraftDirty("default_root", "/a ", "default_root", "/a")).toBe(false);
    expect(isVaultRootDraftDirty("default_root", "/b", "default_root", "/a")).toBe(true);
  });
});

describe("confirmNotesForReplacePolicy", () => {
  it("maps each policy to continue notes by default", () => {
    expect(confirmNotesForReplacePolicy("delete")).toEqual([
      "modal.vault_root_gate.continue_confirm_note.delete",
    ]);
    expect(confirmNotesForReplacePolicy("rename", "apply")).toEqual([
      "modal.data_folder.apply_confirm_note.rename",
    ]);
    expect(confirmNotesForReplacePolicy("reset_settings")).toEqual([
      "modal.vault_root_gate.continue_confirm_note.reset_settings",
    ]);
    expect(confirmNotesForReplacePolicy("reset_settings", "apply")).toEqual([
      "modal.data_folder.apply_confirm_note.reset_settings",
    ]);
    expect(confirmNotesForReplacePolicy(null)).toBeUndefined();
  });
});

describe("diskFromDirStatus", () => {
  it("keeps an unplugged grant distinct from a writable-location failure", () => {
    expect(diskFromDirStatus("unreachable")).toBe("unreachable");
    expect(diskFromDirStatus("unreadable")).toBe("unreadable");
    expect(vaultRootDiskProblemKey("unreachable")).toBe("modal.vault_root_setup.error_unreachable");
    expect(vaultRootDiskProblemKey("unreadable")).toBe("modal.vault_root_setup.error_io");
    expect(
      vaultRootGateFromState({ dirty: true, disk: "unreachable", replacePolicy: null }),
    ).toMatchObject({
      blocksPrimary: true,
      disk: "unreachable",
    });
  });
});

describe("visibleVaultRootDisk", () => {
  it("hides a result that belongs to another draft", () => {
    const previous = vaultRootDraftKey("custom_root", "content://tree/old");
    const next = vaultRootDraftKey("custom_root", "content://tree/new");
    expect(visibleVaultRootDisk("unreadable", previous, next, true)).toBe("checking");
  });

  it("shows the result once this draft has been checked", () => {
    const key = vaultRootDraftKey("custom_root", "content://tree/new");
    expect(visibleVaultRootDisk("ready", key, key, true)).toBe("ready");
    expect(visibleVaultRootDisk("unreadable", key, key, true)).toBe("unreadable");
  });

  it("ignores a stale failure when the draft is clean", () => {
    expect(
      visibleVaultRootDisk("unreadable", "", vaultRootDraftKey("default_root", ""), false),
    ).toBe("ready");
  });
});

describe("vaultRootGateFromState", () => {
  it("does not block when draft is clean", () => {
    expect(
      vaultRootGateFromState({ dirty: false, disk: "incomplete", replacePolicy: null }),
    ).toEqual({ blocksPrimary: false, disk: "ready" });
  });

  it("blocks while checking / unreadable / needs folder / not vault capable", () => {
    for (const disk of [
      "checking",
      "unreadable",
      "unauthorized",
      "unreachable",
      "needs_folder",
      "not_vault_capable",
    ] as const) {
      expect(vaultRootGateFromState({ dirty: true, disk, replacePolicy: null }).blocksPrimary).toBe(
        true,
      );
    }
  });

  it("blocks incomplete until replace policy is chosen", () => {
    expect(
      vaultRootGateFromState({ dirty: true, disk: "incomplete", replacePolicy: null }),
    ).toMatchObject({ blocksPrimary: true, disk: "incomplete" });

    const withPolicy = vaultRootGateFromState({
      dirty: true,
      disk: "incomplete",
      replacePolicy: "delete",
      primaryAction: "apply",
    });
    expect(withPolicy.blocksPrimary).toBe(false);
    expect(withPolicy.confirmNotes).toEqual(["modal.data_folder.apply_confirm_note.delete"]);
  });

  it("allows will_create with create confirm note", () => {
    const gate = vaultRootGateFromState({
      dirty: true,
      disk: "will_create",
      replacePolicy: null,
    });
    expect(gate.blocksPrimary).toBe(false);
    expect(gate.confirmNotes).toEqual(["modal.vault_root_gate.continue_confirm_note.create"]);
  });

  it("allows ready dirty draft without notes", () => {
    expect(vaultRootGateFromState({ dirty: true, disk: "ready", replacePolicy: null })).toEqual({
      blocksPrimary: false,
      disk: "ready",
      replacePolicy: undefined,
    });
  });
});
