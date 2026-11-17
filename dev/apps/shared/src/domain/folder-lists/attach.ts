import {
  parseChoiceName,
  parseFolderState,
  parseSwitches,
  type ChoiceName,
  type FolderState,
  type FolderSwitch,
} from "./switches";

/**
 * What `vault_unlocked_folder_attach` did for an encrypted vault right after
 * its open. The desktop shows it as the toast; core alone decides whether a
 * folder is wanted.
 */
export type AttachAnswer =
  /** The folder the selection names is mounted. */
  | { outcome: "mounted"; path: string }
  /** The selected folder failed; the vault's folder is mounted in the first choice that works. */
  | { outcome: "switched"; path: string; switches: FolderSwitch[] }
  /** The vault's switch is off, or this device mounts no folder. */
  | { outcome: "off" }
  /** FUSE or WinFsp is not installed. */
  | { outcome: "driver_missing" }
  /** Nothing is selected on this device. */
  | { outcome: "unset" }
  /** No folder of the chain works; the selection stays. `reason` is the selected folder's. */
  | { outcome: "unavailable"; path: string; reason: FolderState }
  /** The mount failed for a reason that is not the folder's. */
  | { outcome: "failed" };

export function parseAttachAnswer(raw: unknown): AttachAnswer {
  const body = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const path = typeof body.path === "string" ? body.path : "";
  switch (body.outcome) {
    case "mounted":
      return { outcome: "mounted", path };
    case "switched":
      return { outcome: "switched", path, switches: parseSwitches(body.switches) };
    case "off":
    case "driver_missing":
    case "unset":
      return { outcome: body.outcome };
    case "unavailable":
      return { outcome: "unavailable", path, reason: parseFolderState(body.reason) };
    default:
      return { outcome: "failed" };
  }
}

/** A vault's unlocked folder on this device, for its Info window. */
export interface UnlockedFolderInfo {
  /** The vault's own choice: a row, or the app's. */
  choice: ChoiceName;
  /** The vault's folder there, when something is selected. */
  path: string | null;
  mounted: boolean;
}

export function parseUnlockedFolderInfo(raw: unknown): UnlockedFolderInfo {
  const body = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    choice: parseChoiceName(body.choice) ?? { kind: "nothing" },
    path: typeof body.path === "string" ? body.path : null,
    mounted: body.mounted === true,
  };
}

/** Where an open vault's item is in the OS (`vault_fs_os_path`). */
export type OsFolderAnswer =
  | { state: "ready"; osPath: string }
  /** The unlocked folder is still being attached: ask again shortly. */
  | { state: "attaching" }
  /** No unlocked folder now (the switch is off, none is chosen, a phone, …): none is offered. */
  | { state: "none" };

export function parseOsFolderAnswer(raw: unknown): OsFolderAnswer {
  const body = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  if (body.state === "ready" && typeof body.osPath === "string") {
    return { state: "ready", osPath: body.osPath };
  }
  if (body.state === "attaching") return { state: "attaching" };
  return { state: "none" };
}
