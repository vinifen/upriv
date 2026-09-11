/**
 * Hidden vaults — list/UI contract that does not need vault I/O.
 *
 * When `vault_list` / `vault_config_save` replace the mock, add:
 * - `[vault] hidden = true` survives `vault_config_save` + `vault_list`
 * - toggling hidden updates the list item without a name in `log_event`
 * - the session log line is `vault_hidden` with no vault id or display name
 * - open / export / last-opened still work for a hidden vault after show-hidden
 * - Case C (`vault_not_found`) must not leak a hidden vault’s name in the toast
 */
import { describe, expect, it } from "vitest";
import { createDefaultAppSettings } from "../../app-settings";
import { createEmptyCreateVaultDraft, buildCreateVaultResult } from "../../vault-create";
import { createVaultDraftFixture } from "../../vault-create/tests/fixtures";
import { applyVaultListHierarchySort, filterVaultListRowsBySearch } from "../../vault-groups";
import type { VaultGroup } from "../../vault-groups";
import {
  VAULT_GROUP_HIDDEN_LOG_EVENT,
  VAULT_HIDDEN_LOG_EVENT,
  shouldRecordVaultHidden,
} from "../../logs";
import { buildSystemInfoSections } from "../../system-info";
import type { InfoTranslate } from "../../info";
import { DEFAULT_VAULT_LIST_SORT } from "../sort";
import { filterVisibleVaults } from "../visibility";
import { vaultListItemFixture } from "./fixtures";

const t: InfoTranslate = (key) => key;

function group(
  partial: Partial<VaultGroup> & Pick<VaultGroup, "id" | "groupedVaults">,
): VaultGroup {
  return {
    displayName: partial.id,
    order: 0,
    collapsed: false,
    hidden: false,
    groupedVaultSort: "order",
    groupedVaultSortDirection: "asc",
    ...partial,
  };
}

describe("hidden vaults", () => {
  const visible = vaultListItemFixture({ id: "notes", displayName: "Notes", hidden: false });
  const hidden = vaultListItemFixture({ id: "secret", displayName: "Secret", hidden: true });

  it("omits hidden vaults from the list unless show-hidden is on", () => {
    expect(filterVisibleVaults([visible, hidden], false).map((v) => v.id)).toEqual(["notes"]);
    expect(filterVisibleVaults([visible, hidden], true).map((v) => v.id)).toEqual([
      "notes",
      "secret",
    ]);
  });

  it("defaults create + app settings to not hidden / not always-show", () => {
    expect(createEmptyCreateVaultDraft([]).hidden).toBe(false);
    expect(createDefaultAppSettings().ui.always_show_hidden_vaults).toBe(false);
  });

  it("persists hidden on the create result that will become config.toml", () => {
    const result = buildCreateVaultResult(createVaultDraftFixture([], { hidden: true }), []);
    expect(result.settings.vault.hidden).toBe(true);
  });

  it("omits hidden grouped vaults and does not let search match their name", () => {
    const rows = applyVaultListHierarchySort(
      [visible, hidden],
      [group({ id: "work", groupedVaults: ["notes", "secret"] })],
      DEFAULT_VAULT_LIST_SORT,
    );
    const work = rows.find((row) => row.kind === "group" && row.group.id === "work");
    expect(work?.kind === "group" ? work.groupedVaults.map((v) => v.id) : []).toEqual(["notes"]);
    expect(work?.kind === "group" ? work.hiddenVaultCount : -1).toBe(1);
    expect(filterVaultListRowsBySearch(rows, "secret")).toEqual([]);
  });

  it("puts hidden vaults back when show-hidden is on", () => {
    const rows = applyVaultListHierarchySort(
      [visible, hidden],
      [group({ id: "work", groupedVaults: ["notes", "secret"] })],
      DEFAULT_VAULT_LIST_SORT,
      { showHiddenVaults: true },
    );
    const work = rows.find((row) => row.kind === "group" && row.group.id === "work");
    expect(work?.kind === "group" ? work.groupedVaults.map((v) => v.id) : []).toEqual([
      "notes",
      "secret",
    ]);
    expect(work?.kind === "group" ? work.hiddenVaultCount : -1).toBe(0);
  });

  it("omits a hidden group unless show-hidden is on", () => {
    const rows = applyVaultListHierarchySort(
      [visible],
      [group({ id: "secrets", groupedVaults: ["notes"], hidden: true })],
      DEFAULT_VAULT_LIST_SORT,
    );
    expect(rows.some((row) => row.kind === "group")).toBe(false);
    expect(rows.some((row) => row.kind === "vault")).toBe(false);
    expect(filterVaultListRowsBySearch(rows, "secrets")).toEqual([]);
  });

  it("shows a hidden group when show-hidden is on", () => {
    const rows = applyVaultListHierarchySort(
      [visible],
      [group({ id: "secrets", groupedVaults: ["notes"], hidden: true })],
      DEFAULT_VAULT_LIST_SORT,
      { showHiddenVaults: true },
    );
    expect(rows.some((row) => row.kind === "group" && row.group.id === "secrets")).toBe(true);
  });

  it("records vault_hidden only on the false → true transition, with no name in the event id", () => {
    expect(VAULT_HIDDEN_LOG_EVENT).toBe("vault_hidden");
    expect(VAULT_GROUP_HIDDEN_LOG_EVENT).toBe("vault_group_hidden");
    expect(shouldRecordVaultHidden(false, true)).toBe(true);
    expect(shouldRecordVaultHidden(true, true)).toBe(false);
    expect(shouldRecordVaultHidden(true, false)).toBe(false);
  });

  it("labels System Info inventory as excluding hidden vaults", () => {
    const settings = createDefaultAppSettings();
    const sections = buildSystemInfoSections(
      {
        app: { version: "0.1.0-beta", distribution: "dev", versionOffline: true },
        root: { status: "found", rootPath: "/data", source: "default_root" },
        rootMode: "default_root",
        inventory: { vaultsTotal: 1, vaultsOpen: 0, groupsTotal: 0 },
        ui: settings.ui,
        logging: settings.logging,
        workspace: { path: "/data/workspace" },
        lastOpenedVault: "",
        paths: { logsDir: "/data/.upriv/logs", appHome: "/data" },
      },
      t,
    );
    const total = sections
      .flatMap((section) => section.fields)
      .find((field) => field.id === "vaults_total");
    expect(total?.label).toContain("modal.info.field.vaults_total_excludes_hidden");
    const groupsTotal = sections
      .flatMap((section) => section.fields)
      .find((field) => field.id === "groups_total");
    expect(groupsTotal?.label).toContain("modal.info.field.groups_total_excludes_hidden");
  });
});
