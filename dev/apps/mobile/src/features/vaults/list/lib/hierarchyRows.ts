import type { VaultGroup, VaultListItem, VaultListRootRow } from "@upriv/shared";

export type BlocksGroupCell = {
  key: string;
  group: VaultGroup;
  groupedVaults: VaultListItem[];
  /** Membership size — not collapsed visibility (Collapse keeps children mounted). */
  memberCount: number;
};

export type BlocksPackCell =
  { kind: "vault"; key: string; vault: VaultListItem } | ({ kind: "group" } & BlocksGroupCell);

export type FlatHierarchyRow =
  | ({ kind: "group_block" } & BlocksGroupCell)
  | { key: string; kind: "vault"; vault: VaultListItem }
  | { key: string; kind: "cell_row"; cells: BlocksPackCell[] };

export function flattenHierarchyRows(rows: VaultListRootRow[]): FlatHierarchyRow[] {
  const out: FlatHierarchyRow[] = [];
  for (const row of rows) {
    if (row.kind === "vault") {
      out.push({ key: `vault:${row.vault.id}`, kind: "vault", vault: row.vault });
      continue;
    }
    out.push({
      key: `group:${row.group.id}`,
      kind: "group_block",
      group: row.group,
      // Keep members while collapsed so UI can animate height without remount/pack flicker.
      groupedVaults: row.groupedVaults,
      memberCount: row.groupedVaults.length,
    });
  }
  return out;
}

export function groupCellFromRow(
  row: Extract<VaultListRootRow, { kind: "group" }>,
): BlocksGroupCell {
  return {
    key: `group:${row.group.id}`,
    group: row.group,
    groupedVaults: row.groupedVaults,
    memberCount: row.groupedVaults.length,
  };
}

/** Pack vaults and 0–1-member groups into grid rows; wider groups keep a full row.
 * A lone group cell is emitted as `group_block` so FlatList keys stay `group:id`
 * when membership crosses the 1↔2 threshold (avoids remount flicker). */
export function packRowsForBlocks(rows: VaultListRootRow[], columns: number): FlatHierarchyRow[] {
  const out: FlatHierarchyRow[] = [];
  let batch: BlocksPackCell[] = [];
  const flush = () => {
    if (batch.length === 0) return;
    if (batch.length === 1 && batch[0]!.kind === "group") {
      const cell = batch[0]!;
      out.push({
        kind: "group_block",
        key: cell.key,
        group: cell.group,
        groupedVaults: cell.groupedVaults,
        memberCount: cell.memberCount,
      });
    } else {
      out.push({
        key: `cell-row:${batch.map((cell) => cell.key).join(",")}`,
        kind: "cell_row",
        cells: batch,
      });
    }
    batch = [];
  };
  for (const row of rows) {
    if (row.kind === "vault") {
      batch.push({ kind: "vault", key: `vault:${row.vault.id}`, vault: row.vault });
      if (batch.length >= columns) flush();
      continue;
    }
    const cell = groupCellFromRow(row);
    // Pack by membership, not collapsed visibility — collapsed must not remount keys.
    const memberCount = cell.memberCount;
    if (memberCount <= 1) {
      batch.push({ kind: "group", ...cell });
      if (batch.length >= columns) flush();
      continue;
    }
    flush();
    out.push({ kind: "group_block", ...cell });
  }
  flush();
  return out;
}
