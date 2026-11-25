import { describe, expect, it } from "vitest";
import {
  backupCloseFailureToastKey,
  closeBackupReasonToastKey,
  parseCloseVaultOutcome,
} from "../VaultLifecycleService";

describe("parseCloseVaultOutcome", () => {
  it("reads why unchanged files got a zip, and where it went", () => {
    expect(
      parseCloseVaultOutcome({
        backupFailed: false,
        backupFailure: null,
        backupSwitches: [],
        backupReason: "moved",
        backupFolder: "/mnt/usb/upriv-notes-backups",
        plain: null,
      }),
    ).toEqual({
      backupFailed: false,
      backupFailure: null,
      backupSwitches: [],
      backupReason: "moved",
      backupFolder: "/mnt/usb/upriv-notes-backups",
      plain: null,
    });
  });

  it("reads a failed backup with an unknown reason as other, and drops what it does not know", () => {
    const outcome = parseCloseVaultOutcome({
      backupFailed: true,
      backupFailure: "melted",
      backupReason: "because",
      backupFolder: 7,
    });
    expect(outcome.backupFailure).toBe("other");
    expect(outcome.backupReason).toBeNull();
    expect(outcome.backupFolder).toBeNull();
  });

  it("reads anything that is not an answer as a close with nothing to report", () => {
    for (const raw of [null, undefined, "closed", 3]) {
      expect(parseCloseVaultOutcome(raw)).toEqual({
        backupFailed: false,
        backupFailure: null,
        backupSwitches: [],
        backupReason: null,
        backupFolder: null,
        plain: null,
      });
    }
  });
});

describe("close backup toasts", () => {
  it("names a toast for each reason and each failure", () => {
    expect(closeBackupReasonToastKey("rewritten")).toBe("toast.backup_on_close.rewritten");
    expect(closeBackupReasonToastKey("missing")).toBe("toast.backup_on_close.missing");
    expect(closeBackupReasonToastKey("first")).toBe("toast.backup_on_close.first");
    expect(backupCloseFailureToastKey(null)).toBe("toast.backup_on_close_failed");
    expect(backupCloseFailureToastKey("disk_full")).toBe("toast.backup_on_close_failed.disk_full");
  });
});
