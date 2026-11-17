/**
 * What a folder can do right now (core `FolderState`). Every state but `ok`
 * is a failure of the folder itself, the kind that hands a selection over.
 */
export type FolderState =
  | "ok"
  | "missing"
  | "not_responding"
  | "no_permission"
  | "no_room"
  | "file_too_large"
  | "unsupported"
  | "names_unsupported"
  | "refused"
  | "other";

const FOLDER_STATES = new Set<FolderState>([
  "ok",
  "missing",
  "not_responding",
  "no_permission",
  "no_room",
  "file_too_large",
  "unsupported",
  "names_unsupported",
  "refused",
  "other",
]);

export function parseFolderState(raw: unknown): FolderState {
  return typeof raw === "string" && FOLDER_STATES.has(raw as FolderState)
    ? (raw as FolderState)
    : "other";
}

/** Which list a switch happened in. */
export type SwitchList = "data_folder" | "unlocked_folder" | "backup";

/** A choice as a switch names it. */
export type ChoiceName =
  | { kind: "row"; number: number; name: string }
  | { kind: "fixed"; choice: string }
  | { kind: "nothing" };

/** A selection core changed because its folder failed: the toast and the log say so. */
export interface FolderSwitch {
  list: SwitchList;
  level: "app" | "vault";
  /** The vault, for a vault's list. */
  vault?: string;
  from: ChoiceName;
  to: ChoiceName;
  reason: FolderState;
  /** False when the switch holds for this run only: its file could not be written. */
  saved: boolean;
}

/** A choice as core names it; `null` when it is not one. */
export function parseChoiceName(raw: unknown): ChoiceName | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as Record<string, unknown>;
  if (body.kind === "row" && typeof body.number === "number") {
    return {
      kind: "row",
      number: body.number,
      name: typeof body.name === "string" ? body.name : "",
    };
  }
  if (body.kind === "fixed" && typeof body.choice === "string") {
    return { kind: "fixed", choice: body.choice };
  }
  if (body.kind === "nothing") return { kind: "nothing" };
  return null;
}

function parseSwitch(raw: unknown): FolderSwitch | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as Record<string, unknown>;
  const from = parseChoiceName(body.from);
  const to = parseChoiceName(body.to);
  const list = body.list;
  const level = body.level;
  if (
    !from ||
    !to ||
    (list !== "data_folder" && list !== "unlocked_folder" && list !== "backup") ||
    (level !== "app" && level !== "vault")
  ) {
    return null;
  }
  return {
    list,
    level,
    ...(typeof body.vault === "string" ? { vault: body.vault } : {}),
    from,
    to,
    reason: parseFolderState(body.reason),
    saved: body.saved !== false,
  };
}

/** The switches of a reply; what cannot be read is left out. */
export function parseSwitches(raw: unknown): FolderSwitch[] {
  return Array.isArray(raw) ? raw.flatMap((item) => parseSwitch(item) ?? []) : [];
}

/** One switch, or `null`. */
export function parseOneSwitch(raw: unknown): FolderSwitch | null {
  return parseSwitch(raw);
}

/** Group key of an app list switch shown once for every vault it moved. */
export function switchKey(change: FolderSwitch): string {
  const name = (choice: ChoiceName) =>
    choice.kind === "row" ? `r${choice.number}` : choice.kind === "fixed" ? choice.choice : "-";
  return [change.list, change.level, change.vault ?? "", name(change.from), name(change.to)].join(
    "|",
  );
}

/** Each switch once: Close all and a vault's close may report the same app switch. */
export function uniqueSwitches(switches: readonly FolderSwitch[]): FolderSwitch[] {
  const seen = new Set<string>();
  return switches.filter((change) => {
    const key = switchKey(change);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
