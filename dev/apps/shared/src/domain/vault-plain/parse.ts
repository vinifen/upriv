import type { I18nKey } from "../../i18n/catalog";
import { parseDeviceRef } from "../device";
import { parseSwitches } from "../folder-lists";
import type {
  PlainCloseSummary,
  PlainDestination,
  PlainFolderClass,
  PlainHeldStatus,
  PlainLeftover,
  PlainRecord,
  PlainRecordState,
  PlainRecoveryOffers,
  PlainWipe,
} from "./types";

const FOLDER_CLASSES = new Set<PlainFolderClass>(["local", "removable", "network", "cloud"]);
const RECORD_STATES = new Set<PlainRecordState>(["leftover", "gone", "away", "elsewhere"]);

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

export function parseFolderClass(value: unknown): PlainFolderClass | null {
  return typeof value === "string" && FOLDER_CLASSES.has(value as PlainFolderClass)
    ? (value as PlainFolderClass)
    : null;
}

export function parsePlainDestination(raw: unknown): PlainDestination | null {
  const body = record(raw);
  if (!body) return null;
  const folderClass = parseFolderClass(body.class);
  if (typeof body.path !== "string" || body.path.length === 0 || !folderClass) return null;
  return { path: body.path, class: folderClass, switches: parseSwitches(body.switches) };
}

/** The plain-text folders on record for a vault row (`plainRecords` of `vault_list`). */
export function parsePlainRecords(raw: unknown): PlainRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const body = record(item);
    const device = body ? parseDeviceRef(body.device, body.system) : null;
    if (
      !body ||
      !device ||
      typeof body.path !== "string" ||
      typeof body.token !== "string" ||
      typeof body.state !== "string" ||
      !RECORD_STATES.has(body.state as PlainRecordState)
    ) {
      return [];
    }
    return [
      {
        device,
        path: body.path,
        token: body.token,
        state: body.state as PlainRecordState,
      },
    ];
  });
}

/**
 * The record that keeps the vault from opening on this device: a folder this
 * device cannot reach. The row names its device and its drive, with Retry
 * and Forget.
 */
export function unreachablePlainRecord(records: readonly PlainRecord[]): PlainRecord | null {
  return records.find((one) => one.state === "away" || one.state === "elsewhere") ?? null;
}

export function parsePlainLeftover(raw: unknown): PlainLeftover | null {
  if (raw === null) return null;
  const body = record(raw);
  if (!body || typeof body.path !== "string" || typeof body.since !== "string") return null;
  return {
    path: body.path,
    since: body.since,
    found: body.found === true,
    files: finite(body.files),
    bytes: finite(body.bytes),
  };
}

export function parsePlainWipe(raw: unknown): PlainWipe {
  const body = record(raw);
  return { wiped: finite(body?.wiped), kept: finite(body?.kept) };
}

export function parsePlainCloseSummary(raw: unknown): PlainCloseSummary | null {
  const body = record(raw);
  if (!body) return null;
  const totals = record(body.totals) ?? {};
  return {
    saved: finite(body.saved),
    conflicts: finite(body.conflicts),
    heldDeletions: finite(body.heldDeletions),
    removed: finite(body.removed),
    kept: finite(body.kept),
    leftover: body.leftover === true,
    totals: {
      added: finite(totals.added),
      changed: finite(totals.changed),
      removed: finite(totals.removed),
    },
    backupPinned: body.backupPinned === true,
  };
}

export function parsePlainHeldStatus(raw: unknown): PlainHeldStatus {
  const body = record(raw);
  const listed = Array.isArray(body?.heldDeletions)
    ? body.heldDeletions.filter((path): path is string => typeof path === "string")
    : [];
  return { heldDeletions: listed, heldCount: finite(body?.heldCount) };
}

/** A folder that is still there is wiped. No folder means unlock the encrypted vault. */
export function plainRecoveryOffers(leftover: PlainLeftover | null): PlainRecoveryOffers {
  return { remove: leftover?.found === true };
}

/** Warning shown before writing a folder that may leave this computer. Local needs none. */
export function plainFolderClassI18nKey(folderClass: PlainFolderClass): I18nKey | null {
  switch (folderClass) {
    case "local":
      return null;
    case "removable":
      return "plain.place.class.removable";
    case "network":
      return "plain.place.class.network";
    case "cloud":
      return "plain.place.class.cloud";
  }
}
