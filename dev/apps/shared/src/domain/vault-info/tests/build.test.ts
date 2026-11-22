import { describe, expect, it } from "vitest";
import type { InfoTranslate } from "../../info";
import { formatIsoDate } from "../../format/datetime";
import { vaultListItemFixture } from "../../vault-list/tests/fixtures";
import { vaultSettingsFixture } from "../../vault-settings/tests/fixtures";
import type { VaultBackupEntry, VaultBackupSection } from "../../backups";
import { buildVaultInfoSections } from "../build";
import type { VaultInfoSnapshot } from "../types";

const t: InfoTranslate = (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key);

function entry(fileName: string, createdAt: string, sizeBytes: number): VaultBackupEntry {
  return {
    key: `data/${fileName}`,
    stamp: fileName.slice(0, 14),
    fileName,
    name: "",
    createdAt,
    sizeBytes,
    saved: false,
    path: `/data/.upriv/vaults/notes/backups/${fileName}`,
    lowerUnlockRam: false,
  };
}

function dataFolder(entries: VaultBackupEntry[]): VaultBackupSection {
  return {
    folder: "data",
    kind: "data_folder",
    path: "/data/.upriv/vaults/notes/backups",
    device: null,
    status: "ok",
    entries,
  };
}

function snapshot(overrides: Partial<VaultInfoSnapshot> = {}): VaultInfoSnapshot {
  return {
    vault: vaultListItemFixture({
      id: "notes",
      displayName: "Notes",
      session: "open",
      passwordHint: "hint",
    }),
    settings: vaultSettingsFixture(),
    kdfPreset: "256mib",
    groupName: "Work",
    groupHidden: false,
    backupSections: [
      dataFolder([
        entry("20260528120000-notes.zip", "2026-05-28T12:00:00.000Z", 10),
        entry("20260529120000-notes.zip", "2026-05-29T09:00:00.000Z", 20),
      ]),
    ],
    runtime: {
      openCount: 2,
      lastOpenedAt: "2026-05-29T09:00:00.000Z",
      sessionRamBytes: 1024,
      storeBytes: 2048,
      heldBytes: 0,
      filesBytes: 1024,
      logicalFileCount: 4,
    },
    passwordInSession: true,
    unlockedFolder: {
      choice: { kind: "row", number: 1, name: "SSD" },
      path: "/mnt/ssd/upriv-unlocked/Notes",
      mounted: true,
    },
    keyStatus: { filesWaiting: 0, keyCopiesDue: false, keyCopiesUpdating: false },
    storePath: "/data/.upriv/vaults/notes/store/",
    backupsPath: "/data/.upriv/vaults/notes/backups/",
    storeOpenPath: "/data/.upriv/vaults/notes/store",
    backupsOpenPath: "/data/.upriv/vaults/notes/backups",
    locale: "en",
    ...overrides,
  };
}

function field(
  sections: ReturnType<typeof buildVaultInfoSections>,
  id: string,
): string | undefined {
  return sections.flatMap((section) => section.fields).find((entry) => entry.id === id)?.value;
}

describe("buildVaultInfoSections", () => {
  it("emits identity, status, runtime, storage, crypto, config, backups", () => {
    const sections = buildVaultInfoSections(snapshot(), t);
    expect(sections.map((section) => section.id)).toEqual([
      "identity",
      "status",
      "runtime",
      "storage",
      "unlocked_folder",
      "crypto",
      "config",
      "backups",
    ]);
    expect(field(sections, "storage_mode")).toBe("modal.storage.option.encrypted_dir");
    expect(sections.flatMap((section) => section.fields).map((entry) => entry.id)).not.toContain(
      "plain_files",
    );
    expect(field(sections, "kdf_preset")).toBe("modal.settings.option.kdf.256mib");
    expect(field(sections, "file_manager")).toBe("modal.info.value.eligible");
    expect(field(sections, "backup_skip_unchanged")).toBe("modal.info.value.yes");
    expect(field(sections, "backup_count")).toBe("2");
    expect(field(sections, "backup_latest")).toBe("20260529120000-notes.zip");
    const tied = buildVaultInfoSections(
      snapshot({
        backupSections: [
          dataFolder([
            entry("20260528120000-other.zip", "2026-05-28T12:00:00.000Z", 10),
            entry("20260528120000-notes.zip", "2026-05-28T12:00:00.000Z", 10),
          ]),
        ],
      }),
      t,
    );
    expect(field(tied, "backup_count")).toBe("2");
    expect(field(tied, "backup_latest")).toBe("20260528120000-notes.zip");
    expect(field(sections, "group")).toBe("Work");
    expect(field(sections, "hidden")).toBe("modal.info.value.no");
    expect(field(sections, "hidden_locked_by_group")).toBe("modal.info.value.no");
    expect(field(sections, "last_accessed")).toBe(formatIsoDate("2026-06-01T12:00:00.000Z", "en"));
    expect(field(sections, "last_accessed_at")).toBe("2026-06-01T12:00:00.000Z");
    expect(field(sections, "display_status")).toBe("vault.status.open");
    const storage = sections.flatMap((section) => section.fields);
    expect(storage.find((entry) => entry.id === "store_path")?.openPath).toBe(
      "/data/.upriv/vaults/notes/store",
    );
    expect(storage.find((entry) => entry.id === "backups_path")?.openPath).toBe(
      "/data/.upriv/vaults/notes/backups",
    );
  });

  it("shows the vault's unlocked folder on this device", () => {
    const sections = buildVaultInfoSections(snapshot(), t);
    expect(field(sections, "unlocked_folder_choice")).toBe("SSD");
    expect(field(sections, "unlocked_folder_path")).toBe("/mnt/ssd/upriv-unlocked/Notes");
    expect(field(sections, "unlocked_folder_mounted")).toBe("modal.info.value.yes");
    expect(field(sections, "unlocked_folder_encrypted")).toBe(
      "modal.info.value.encrypted_switch.inherit",
    );
    const plain = buildVaultInfoSections(
      snapshot({ vault: vaultListItemFixture({ storageMode: "upriv_plain" }) }),
      t,
    );
    expect(field(plain, "unlocked_folder_mounted")).toBeUndefined();
  });

  it("keeps session and display_status on Closing together", () => {
    const sections = buildVaultInfoSections(
      snapshot({ vault: vaultListItemFixture({ id: "notes", session: "closing" }) }),
      t,
    );
    expect(field(sections, "display_status")).toBe("vault.status.closing");
    expect(field(sections, "session")).toBe("modal.info.value.session.closing");
    expect(field(sections, "file_manager")).toBe("modal.info.value.not_eligible");
  });

  it("labels a closing vault in its backup phase as backing up", () => {
    const sections = buildVaultInfoSections(
      snapshot({ vault: vaultListItemFixture({ id: "notes", session: "open" }) }),
      t,
      { closingVaultIds: ["notes"], backingUpVaultIds: ["notes"] },
    );
    expect(field(sections, "display_status")).toBe("vault.status.backing_up");
  });

  it("treats display_status open as file-manager eligible even if pipeline is empty", () => {
    const sections = buildVaultInfoSections(snapshot(), t);
    expect(field(sections, "file_manager")).toBe("modal.info.value.eligible");
  });

  it("does not label Closed while an open pipeline is in flight", () => {
    const sections = buildVaultInfoSections(
      snapshot({ vault: vaultListItemFixture({ id: "notes", session: null }) }),
      t,
      { openingVaultIds: ["notes"] },
    );
    expect(field(sections, "display_status")).toBe("vault.status.opening");
    expect(field(sections, "session")).toBe("modal.info.value.session.none");
  });

  it("labels queued FIFO jobs as queued", () => {
    const sections = buildVaultInfoSections(
      snapshot({ vault: vaultListItemFixture({ id: "notes", session: null }) }),
      t,
      { queuedVaultIds: ["notes"] },
    );
    expect(field(sections, "display_status")).toBe("vault.status.queued");
  });

  it("shows the keys and, while open, the files that wait and the key copies", () => {
    const open = buildVaultInfoSections(
      snapshot({
        vault: vaultListItemFixture({
          id: "notes",
          session: "open",
          keyCount: 3,
          passwordChange: "unfinished",
        }),
        keyStatus: { filesWaiting: 7, keyCopiesDue: true, keyCopiesUpdating: false },
      }),
      t,
    );
    expect(field(open, "key_count")).toBe("3");
    expect(field(open, "password_change")).toBe("modal.info.value.password_change.unfinished");
    expect(field(open, "files_waiting")).toBe("7");
    expect(field(open, "key_copies")).toBe("modal.info.value.key_copies.due");
    const updating = buildVaultInfoSections(
      snapshot({ keyStatus: { filesWaiting: 0, keyCopiesDue: true, keyCopiesUpdating: true } }),
      t,
    );
    expect(field(updating, "key_copies")).toBe("modal.info.value.key_copies.updating");

    const closed = buildVaultInfoSections(
      snapshot({
        vault: vaultListItemFixture({ id: "notes", session: null, passwordChange: "pending" }),
        keyStatus: null,
      }),
      t,
    );
    expect(field(closed, "password_change")).toBe("modal.info.value.password_change.pending");
    expect(field(closed, "key_count")).toBe("—");
    expect(field(closed, "files_waiting")).toBeUndefined();
    expect(field(closed, "key_copies")).toBeUndefined();
  });

  it("labels a delete and the closed-vault work", () => {
    const deleting = snapshot({
      vault: vaultListItemFixture({ id: "notes", session: "deleting", deleteUnfinished: true }),
      keyStatus: null,
    });
    const sections = buildVaultInfoSections(deleting, t);
    expect(field(sections, "session")).toBe("modal.info.value.session.deleting");
    expect(field(sections, "display_status")).toBe("vault.status.delete_unfinished");
  });

  it("labels export and the password and unlock-RAM changes on the closed vault", () => {
    const vault = snapshot({ vault: vaultListItemFixture({ id: "notes", session: null }) });
    expect(
      field(buildVaultInfoSections(vault, t, { exportingVaultIds: ["notes"] }), "display_status"),
    ).toBe("vault.status.exporting");
    expect(
      field(
        buildVaultInfoSections(vault, t, { passwordChangeVaultIds: ["notes"] }),
        "display_status",
      ),
    ).toBe("vault.status.changing_password");
    expect(
      field(buildVaultInfoSections(vault, t, { kdfChangeVaultIds: ["notes"] }), "display_status"),
    ).toBe("vault.status.changing_kdf");
  });

  it("falls back when settings and kdf are missing", () => {
    const sections = buildVaultInfoSections(
      snapshot({
        settings: null,
        kdfPreset: null,
        groupName: null,
        backupSections: [],
        vault: vaultListItemFixture({ session: null }),
      }),
      t,
    );
    expect(field(sections, "config_unavailable")).toBe("—");
    expect(field(sections, "kdf_preset")).toBe("—");
    expect(field(sections, "file_manager")).toBe("modal.info.value.not_eligible");
    expect(field(sections, "backup_latest")).toBe("—");
  });

  it("shows an em dash when runtime counters are unknown", () => {
    const sections = buildVaultInfoSections(
      snapshot({
        runtime: {
          openCount: null,
          lastOpenedAt: null,
          sessionRamBytes: null,
          storeBytes: null,
          heldBytes: null,
          filesBytes: null,
          logicalFileCount: null,
        },
      }),
      t,
    );
    expect(field(sections, "open_count")).toBe("—");
    expect(field(sections, "last_opened_at")).toBe("—");
    expect(field(sections, "session_ram")).toBe("—");
    expect(field(sections, "logical_file_count")).toBe("—");
    expect(field(sections, "store_size")).toBe("—");
  });

  it("shows loading for the backups and store size it is still reading", () => {
    const base = snapshot();
    const sections = buildVaultInfoSections(
      {
        ...base,
        backupSections: null,
        runtime: { ...base.runtime, storeBytes: "measuring", filesBytes: "measuring" },
      },
      t,
    );
    expect(field(sections, "store_size")).toBe("modal.info.loading");
    expect(field(sections, "files_size")).toBe("modal.info.loading");
    expect(field(sections, "backup_folder_in_use")).toBe("modal.info.loading");
    expect(field(sections, "backup_count")).toBe("modal.info.loading");
    expect(field(sections, "backup_latest")).toBe("modal.info.loading");
    expect(field(sections, "backup_total_size")).toBe("modal.info.loading");
  });

  it("shows set-aside data only for a vault that holds some", () => {
    const base = snapshot();
    expect(field(buildVaultInfoSections(base, t), "held_size")).toBeUndefined();
    const sections = buildVaultInfoSections(
      { ...base, runtime: { ...base.runtime, heldBytes: 2048 } },
      t,
    );
    expect(field(sections, "held_size")).toBe("2.0 KB");
  });

  it("names the backup folder in use and each folder that holds zips", () => {
    expect(field(buildVaultInfoSections(snapshot(), t), "backup_folder_in_use")).toBe(
      "folder_list.choice.data_folder",
    );
    const usb: VaultBackupSection = {
      folder: "f1",
      kind: "in_use",
      path: "/mnt/usb/upriv-notes-backups",
      device: { id: "3f9c2a7d4e1b8c6f0a2d4e6f8a1b3c5d", system: "linux" },
      status: "ok",
      entries: [entry("20260530120000-notes.zip", "2026-05-30T12:00:00.000Z", 5)],
    };
    const sections = buildVaultInfoSections(snapshot({ backupSections: [dataFolder([]), usb] }), t);
    const named =
      '/mnt/usb/upriv-notes-backups · device.name:{"system":"device.system.linux","tag":"3f9c2"}';
    expect(field(sections, "backup_folder_in_use")).toBe(named);
    expect(field(sections, "backup_folder_f1")).toBe(named);
    expect(field(sections, "backup_folder_data")).toBeUndefined();
    const row = sections
      .flatMap((section) => section.fields)
      .find((one) => one.id === "backup_folder_f1");
    expect(row?.openPath).toBe("/mnt/usb/upriv-notes-backups");
  });
});
