import { describe, expect, it } from "vitest";
import { RpcError } from "../../core-rpc/errors";
import {
  parsePasswordChangeFinishResult,
  parsePasswordChangeResult,
  parseUnlockRamChangeResult,
  parseVaultKeyStatus,
  passwordChangeReportLines,
  passwordChangeSpaceShort,
  unlockRamChangeReportLines,
  type PasswordChangeResult,
} from "..";

function changed(patch: Partial<PasswordChangeResult> = {}): PasswordChangeResult {
  return {
    backup: "20261117120000-notes.zip",
    backupSkipped: null,
    unreadable: 0,
    keyCopies: "done",
    ...patch,
  };
}

const keys = (lines: ReturnType<typeof passwordChangeReportLines>) =>
  lines?.map((line) => line.key) ?? null;

describe("passwordChangeReportLines", () => {
  it("says the change is made and the backup it wrote is kept", () => {
    expect(
      keys(passwordChangeReportLines({ kind: "change", result: changed(), stopped: false })),
    ).toEqual(["vault.change_password.success", "vault.change_password.backup_kept"]);
  });

  it("names why no backup was written, and says nothing when the switch was off", () => {
    const noRoom = changed({ backup: null, backupSkipped: "no_room" });
    expect(
      keys(passwordChangeReportLines({ kind: "change", result: noRoom, stopped: false })),
    ).toEqual(["vault.change_password.success", "vault.change_password.backup_skipped.no_room"]);
    const off = changed({ backup: null, backupSkipped: "off" });
    expect(
      keys(passwordChangeReportLines({ kind: "change", result: off, stopped: false })),
    ).toEqual(["vault.change_password.success"]);
  });

  it("counts the files with unreadable parts, and says when key copies wait", () => {
    const lines = passwordChangeReportLines({
      kind: "change",
      result: changed({ unreadable: 3, keyCopies: "waiting" }),
      stopped: false,
    });
    expect(keys(lines)).toEqual([
      "vault.change_password.success_key_copies_waiting",
      "vault.change_password.backup_kept",
      "vault.change_password.unreadable_count",
    ]);
    expect(lines?.[2].params).toEqual({ count: "3" });
  });

  it("reports Finish with no backup line", () => {
    expect(
      keys(
        passwordChangeReportLines({
          kind: "finish",
          result: { unreadable: 0, keyCopies: "done" },
          stopped: false,
        }),
      ),
    ).toEqual(["vault.change_password.finished"]);
  });

  it("says a stop left the password, or the waiting files, as they were", () => {
    expect(
      keys(passwordChangeReportLines({ kind: "change", result: null, stopped: true })),
    ).toEqual(["vault.change_password.stopped"]);
    expect(
      keys(passwordChangeReportLines({ kind: "finish", result: null, stopped: true })),
    ).toEqual(["vault.change_password.finish_stopped"]);
  });

  it("leaves a failure to the error line", () => {
    expect(passwordChangeReportLines({ kind: "change", result: null, stopped: false })).toBeNull();
  });
});

describe("unlockRamChangeReportLines", () => {
  it("says the change is made, or that key copies wait, or that it stopped", () => {
    expect(
      unlockRamChangeReportLines({ result: { keyCopies: "done" }, stopped: false })?.[0].key,
    ).toBe("vault.change_kdf.success");
    expect(
      unlockRamChangeReportLines({ result: { keyCopies: "waiting" }, stopped: false })?.[0].key,
    ).toBe("vault.change_kdf.success_key_copies_waiting");
    expect(unlockRamChangeReportLines({ result: null, stopped: true })?.[0].key).toBe(
      "vault.change_kdf.stopped",
    );
    expect(unlockRamChangeReportLines({ result: null, stopped: false })).toBeNull();
  });
});

describe("key change results", () => {
  it("reads a password change result and keeps unknown values out", () => {
    expect(
      parsePasswordChangeResult({
        backup: "a.zip",
        backupSkipped: "later",
        unreadable: -1,
        keyCopies: "waiting",
      }),
    ).toEqual({ backup: "a.zip", backupSkipped: null, unreadable: 0, keyCopies: "waiting" });
    expect(parsePasswordChangeResult(null)).toEqual({
      backup: null,
      backupSkipped: null,
      unreadable: 0,
      keyCopies: "done",
    });
  });

  it("reads Finish and unlock-RAM results", () => {
    expect(parsePasswordChangeFinishResult({ unreadable: 2, keyCopies: "done" })).toEqual({
      unreadable: 2,
      keyCopies: "done",
    });
    expect(parseUnlockRamChangeResult({ keyCopies: "waiting" })).toEqual({ keyCopies: "waiting" });
  });

  it("reads the key status of an open vault only", () => {
    expect(parseVaultKeyStatus({ open: false })).toBeNull();
    expect(
      parseVaultKeyStatus({
        open: true,
        filesWaiting: 4,
        keyCopiesDue: true,
        keyCopiesUpdating: false,
      }),
    ).toEqual({ filesWaiting: 4, keyCopiesDue: true, keyCopiesUpdating: false });
  });

  it("reads the sizes of a refusal for lack of room, and nothing from other errors", () => {
    const short = new RpcError("password_change_space_short", "short", {
      needed: 300,
      available: 100,
    });
    expect(passwordChangeSpaceShort(short)).toEqual({ needed: 300, available: 100 });
    expect(passwordChangeSpaceShort(new RpcError("wrong_password", "no"))).toBeNull();
    expect(passwordChangeSpaceShort(new Error("other"))).toBeNull();
  });
});
