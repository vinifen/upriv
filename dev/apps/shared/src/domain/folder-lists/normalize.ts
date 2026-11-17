import { parseDeviceSystem } from "../device";
import {
  NOTHING_SELECTED,
  type DeviceGroup,
  type DeviceGroups,
  type FolderListPolicy,
  type FolderRow,
  type Selection,
} from "./types";

/** Read one list's device groups from core's wire. A group that cannot be read is left out. */
export function parseDeviceGroups<F extends string>(
  raw: unknown,
  policy: FolderListPolicy<F>,
): DeviceGroups<F> {
  if (typeof raw !== "object" || raw === null) return {};
  const groups: DeviceGroups<F> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const group = parseGroup(value, policy);
    if (group) groups[id] = group;
  }
  return groups;
}

function parseGroup<F extends string>(
  raw: unknown,
  policy: FolderListPolicy<F>,
): DeviceGroup<F> | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as Record<string, unknown>;
  const system = parseDeviceSystem(body.system);
  if (!system) return null;
  const rows = Array.isArray(body.rows) ? body.rows.flatMap(parseRow) : [];
  const highest = rows.reduce((top, row) => Math.max(top, row.number), 0);
  const next = typeof body.next_number === "number" ? body.next_number : 1;
  return {
    system,
    selected: parseSelection(body.selected, policy, rows),
    next_number: Math.max(next, highest + 1),
    rows,
  };
}

function parseRow(raw: unknown): FolderRow[] {
  if (typeof raw !== "object" || raw === null) return [];
  const body = raw as Record<string, unknown>;
  if (typeof body.number !== "number" || typeof body.path !== "string") return [];
  return [
    { number: body.number, name: typeof body.name === "string" ? body.name : "", path: body.path },
  ];
}

/** A missing selection is the list's default; one that names nothing it knows is too. */
export function parseSelection<F extends string>(
  raw: unknown,
  policy: FolderListPolicy<F>,
  rows: readonly FolderRow[],
): Selection<F> {
  if (typeof raw === "number") {
    return rows.some((row) => row.number === raw) ? raw : policy.fallback;
  }
  if (raw === NOTHING_SELECTED && policy.allowsNothing) return NOTHING_SELECTED;
  if (typeof raw === "string" && (policy.fixed as readonly string[]).includes(raw)) {
    return raw as F;
  }
  return policy.fallback;
}
