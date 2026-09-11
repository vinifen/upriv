import { describe, expect, it } from "vitest";
import type { InfoTranslate } from "../../info";
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
      contentsBytes: 2048,
      logicalFileCount: 4,
    },
    passwordInSession: true,
    workspacePath: "/data/workspace/Notes",
    workspacePathIsActive: true,
    contentsPath: "/data/.upriv/vaults/notes/contents/",
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
});
