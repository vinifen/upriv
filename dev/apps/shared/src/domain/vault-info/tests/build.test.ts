import { describe, expect, it } from "vitest";
import type { InfoTranslate } from "../../info";
import { formatIsoDate } from "../../format/datetime";
import { vaultListItemFixture } from "../../vault-list/tests/fixtures";
import { vaultSettingsFixture } from "../../vault-settings/tests/fixtures";
import { buildVaultInfoSections } from "../build";
import type { VaultInfoSnapshot } from "../types";

const t: InfoTranslate = (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key);

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
    backups: [
      { stamp: "20260528T120000", createdAt: "2026-05-28T12:00:00.000Z", sizeBytes: 10 },
      { stamp: "20260529T090000", createdAt: "2026-05-29T09:00:00.000Z", sizeBytes: 20 },
    ],
    runtime: {
      openCount: 2,
      lastOpenedAt: "2026-05-29T09:00:00.000Z",
      sessionRamBytes: 1024,
      storeBytes: 2048,
      logicalFileCount: 4,
    },
    passwordInSession: true,
    workspacePath: "/data/workspace/Notes",
    workspacePathIsActive: true,
    storePath: "/data/.upriv/vaults/notes/store/",
    backupsPath: "/data/.upriv/vaults/notes/backups/",
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
      "crypto",
      "config",
      "backups",
    ]);
    expect(field(sections, "storage_mode")).toBe("modal.settings.option.storage.encrypted_dir");
    expect(field(sections, "kdf_preset")).toBe("modal.settings.option.kdf.256mib");
    expect(field(sections, "file_manager")).toBe("modal.info.value.eligible");
    expect(field(sections, "backup_count")).toBe("2");
    expect(field(sections, "backup_latest")).toBe("20260529T090000");
    expect(field(sections, "group")).toBe("Work");
    expect(field(sections, "hidden")).toBe("modal.info.value.no");
    expect(field(sections, "hidden_locked_by_group")).toBe("modal.info.value.no");
    expect(field(sections, "password_hint_storage")).toBe(
      "modal.info.value.password_hint_plaintext",
    );
    expect(field(sections, "last_accessed")).toBe(formatIsoDate("2026-06-01T12:00:00.000Z", "en"));
    expect(field(sections, "last_accessed_at")).toBe("2026-06-01T12:00:00.000Z");
    expect(field(sections, "display_status")).toBe("vault.status.open");
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

  it("falls back when settings and kdf are missing", () => {
    const sections = buildVaultInfoSections(
      snapshot({
        settings: null,
        kdfPreset: null,
        groupName: null,
        backups: [],
        workspacePathIsActive: false,
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
});
