import type { I18nKey } from "../../i18n/catalog";
import type {
  PendingPlainConfirm,
  PlainCloseSummary,
  PlainDestination,
  PlainFolderClass,
  PlainHeldStatus,
  PlainLeftover,
  PlainPlace,
  PlainRecoveryOffers,
} from "./types";

const FOLDER_CLASSES = new Set<PlainFolderClass>(["local", "removable", "network", "cloud"]);
const PLACES = new Set<PlainPlace>(["data_folder", "app", "vault"]);

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

/** `vault_open` result. `null` means the vault is open. */
export function parsePendingPlainConfirm(raw: unknown): PendingPlainConfirm | null {
  const body = record(raw);
  const pending = record(body?.pendingPlainConfirm);
  if (!pending) return null;
  const folderClass = parseFolderClass(pending.class);
  if (typeof pending.path !== "string" || pending.path.length === 0 || !folderClass) return null;
  return { path: pending.path, class: folderClass };
}

export function parsePlainDestination(raw: unknown): PlainDestination | null {
  const body = record(raw);
  if (!body) return null;
  const folderClass = parseFolderClass(body.class);
  const place =
    typeof body.place === "string" && PLACES.has(body.place as PlainPlace)
      ? (body.place as PlainPlace)
      : null;
  if (typeof body.path !== "string" || body.path.length === 0 || !folderClass || !place)
    return null;
  return { path: body.path, place, class: folderClass };
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
