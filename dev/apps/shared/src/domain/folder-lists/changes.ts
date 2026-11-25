import { holdsSomething } from "./edits";
import { folderPathIssue, sameFolderPath } from "./paths";
import type {
  DeviceGroup,
  DeviceGroups,
  DeviceId,
  FolderListPolicy,
  FolderPathIssue,
  FolderRow,
  GroupChange,
  ListChanges,
} from "./types";

/**
 * What a save sends for one list: per device group, only the parts that
 * changed (its rows and its selection), so core applies them to the
 * file it reads again and what it switched meanwhile in another part stays.
 */
export function listChanges<F extends string>(
  before: DeviceGroups<F>,
  after: DeviceGroups<F>,
  policy: FolderListPolicy<F>,
): ListChanges<F> {
  const groups: Record<DeviceId, GroupChange<F>> = {};
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const change = groupChange(before[id], after[id], policy);
    if (change) groups[id] = change;
  }
  return { groups };
}

export function isEmptyListChanges<F extends string>(changes: ListChanges<F>): boolean {
  return Object.keys(changes.groups).length === 0;
}

function groupChange<F extends string>(
  before: DeviceGroup<F> | undefined,
  after: DeviceGroup<F> | undefined,
  policy: FolderListPolicy<F>,
): GroupChange<F> | null {
  // Only Remove device takes a group, and only another device's.
  if (!after) return before ? { remove: true } : null;
  // A group this draft made and emptied again was never saved.
  if (!before && !holdsSomething(after, policy)) return null;
  const change: GroupChange<F> = {};
  if (!before || !sameRows(before.rows, after.rows)) change.rows = after.rows;
  if (!before || before.next_number !== after.next_number) change.next_number = after.next_number;
  if (!before || before.selected !== after.selected) change.selected = after.selected;
  return Object.keys(change).length > 0 ? change : null;
}

/** The same rows once core trims their names and paths: nothing of them to save. */
function sameRows(a: readonly FolderRow[], b: readonly FolderRow[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (row, index) =>
        row.number === b[index].number &&
        row.name.trim() === b[index].name.trim() &&
        row.path.trim() === b[index].path.trim(),
    )
  );
}

/**
 * A row a save would write: new, or with another name or path once core
 * trims them. A move alone leaves the row as it was saved.
 */
export function rowUnsaved(
  before: { rows: readonly FolderRow[] } | undefined,
  row: FolderRow,
): boolean {
  return !before?.rows.some(
    (old) =>
      old.number === row.number &&
      old.name.trim() === row.name.trim() &&
      old.path.trim() === row.path.trim(),
  );
}

/** What is wrong with a row of a draft. */
export type RowProblem = FolderPathIssue | "duplicate";

/**
 * The problems of the rows of `after`, as core checks them when a save
 * carries the group's rows: a new or changed path against the group's
 * system, and every path, loaded ones too, against the group's other paths
 * and the folders of the fixed choices (`fixedFolders`). A group whose rows
 * did not change sends none, and has no problem.
 */
export function rowProblems<F extends string>(
  before: DeviceGroup<F> | undefined,
  after: DeviceGroup<F>,
  policy: FolderListPolicy<F>,
  fixedFolders: readonly string[] = [],
): Map<number, RowProblem> {
  const problems = new Map<number, RowProblem>();
  if (before && sameRows(before.rows, after.rows)) return problems;
  after.rows.forEach((row, index) => {
    const loaded = before?.rows.some(
      (old) => old.number === row.number && old.path.trim() === row.path.trim(),
    );
    const issue = loaded ? null : folderPathIssue(after.system, policy.kind, row.path);
    if (issue) {
      problems.set(row.number, issue);
      return;
    }
    const others = after.rows.filter((_, at) => at !== index).map((other) => other.path);
    const repeated = [...others, ...fixedFolders].some((other) =>
      sameFolderPath(after.system, row.path, other),
    );
    if (repeated) problems.set(row.number, "duplicate");
  });
  return problems;
}

/** True when a group of `draft` holds a row core would refuse: Save waits for it. */
export function listDraftBlocks<F extends string>(
  saved: DeviceGroups<F>,
  draft: DeviceGroups<F>,
  policy: FolderListPolicy<F>,
  hereId: DeviceId | null,
  fixedHere: readonly string[] = [],
): boolean {
  return Object.entries(draft).some(
    ([id, group]) => rowProblems(saved[id], group, policy, id === hereId ? fixedHere : []).size > 0,
  );
}
