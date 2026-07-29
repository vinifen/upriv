import { describe, expect, it } from "vitest";
import {
  confirmNotesForReplacePolicy,
  isVaultRootDraftDirty,
  vaultRootGateFromState,
} from "../vaultRootSettingsIntent";

describe("isVaultRootDraftDirty", () => {
  it("detects mode or path changes", () => {
    expect(isVaultRootDraftDirty("default_root", "/a", "default_root", "/a")).toBe(false);
    expect(isVaultRootDraftDirty("custom_root", "/a", "default_root", "/a")).toBe(true);
    expect(isVaultRootDraftDirty("default_root", "/a ", "default_root", "/a")).toBe(false);
    expect(isVaultRootDraftDirty("default_root", "/b", "default_root", "/a")).toBe(true);
  });
});

describe("confirmNotesForReplacePolicy", () => {
  it("maps delete/rename policies to continue notes by default", () => {
    expect(confirmNotesForReplacePolicy("delete")).toEqual([
      "modal.vault_root_gate.continue_confirm_note.delete",
    ]);
    expect(confirmNotesForReplacePolicy("rename", "apply")).toEqual([
      "modal.data_folder.apply_confirm_note.rename",
    ]);
    expect(confirmNotesForReplacePolicy(null)).toBeUndefined();
  });
});

describe("vaultRootGateFromState", () => {
  it("does not block when draft is clean", () => {
    expect(
      vaultRootGateFromState({ dirty: false, disk: "incomplete", replacePolicy: null }),
    ).toEqual({ blocksPrimary: false, disk: "ready" });
  });

  it("blocks while checking / unreadable / needs folder", () => {
    for (const disk of ["checking", "unreadable", "needs_folder"] as const) {
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
