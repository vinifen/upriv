import type { I18nKey } from "../../i18n/catalog";
import { RpcError } from "../core-rpc/errors";
import { VAULT_ERROR_CODES } from "../vault/errors/codes";

/**
 * How many blocked items an import names, as core's
 * `IMPORT_BLOCKED_LIST_MAX`. Every one is counted, so a folder that blocks
 * throughout still answers with a list a window can hold.
 */
export const IMPORT_BLOCKED_LIST_MAX = 500;

/** Why an item cannot be imported (`details.items[].reason`). */
export type ImportBlockReason =
  "permission" | "missing" | "unreadable" | "special" | "name" | "link";

export interface ImportBlockedItem {
  /** From the chosen file or folder, its own name first. */
  path: string;
  reason: ImportBlockReason;
}

/**
 * What keeps a chosen file or folder from becoming a vault. Nothing was
 * imported: every blocked item is counted, the first ones named in path order.
 */
export interface ImportBlocked {
  count: number;
  items: ImportBlockedItem[];
  /** The chosen item itself is one, so nothing can be imported without them. */
  whole: boolean;
}

/**
 * The items an import could not take, until their window is closed.
 * `refused`: nothing was imported yet, and the person cancels or imports
 * without them (a new vault, or a file manager drop before its copy).
 * `left_out`: the rest was imported, and these failed on their way in.
 */
export interface ImportBlockedReport {
  /** The vault the import was for. */
  vaultName: string;
  blocked: ImportBlocked;
  stage: "refused" | "left_out";
}

const REASONS: ReadonlySet<string> = new Set<ImportBlockReason>([
  "permission",
  "missing",
  "unreadable",
  "special",
  "name",
  "link",
]);

export const IMPORT_BLOCK_REASON_I18N: Record<ImportBlockReason, I18nKey> = {
  permission: "modal.import_blocked.reason.permission",
  missing: "modal.import_blocked.reason.missing",
  unreadable: "modal.import_blocked.reason.unreadable",
  special: "modal.import_blocked.reason.special",
  name: "modal.import_blocked.reason.name",
  link: "modal.import_blocked.reason.link",
};

/** A reason Upriv does not know still blocks; it reads as unreadable. */
function parseReason(raw: unknown): ImportBlockReason {
  return typeof raw === "string" && REASONS.has(raw) ? (raw as ImportBlockReason) : "unreadable";
}

function parseItem(raw: unknown): ImportBlockedItem[] {
  if (typeof raw !== "object" || raw === null) return [];
  const { path, reason } = raw as Record<string, unknown>;
  if (typeof path !== "string" || !path) return [];
  return [{ path, reason: parseReason(reason) }];
}

/**
 * Why a file could not be read on its way into an open vault
 * (`import_source_unreadable`, `details.reason`); `null` for any other error,
 * which is one of the vault.
 */
export function importSourceReason(error: unknown): ImportBlockReason | null {
  if (!(error instanceof RpcError) || error.code !== VAULT_ERROR_CODES.IMPORT_SOURCE_UNREADABLE) {
    return null;
  }
  const details =
    typeof error.details === "object" && error.details !== null
      ? (error.details as Record<string, unknown>)
      : {};
  return parseReason(details.reason);
}

/** The list an `import_blocked` error carries; `null` for any other error. */
export function parseImportBlocked(error: unknown): ImportBlocked | null {
  if (!(error instanceof RpcError) || error.code !== VAULT_ERROR_CODES.IMPORT_BLOCKED) return null;
  const details =
    typeof error.details === "object" && error.details !== null
      ? (error.details as Record<string, unknown>)
      : {};
  const items = (Array.isArray(details.items) ? details.items.flatMap(parseItem) : []).slice(
    0,
    IMPORT_BLOCKED_LIST_MAX,
  );
  const count =
    typeof details.count === "number" && Number.isFinite(details.count)
      ? Math.max(Math.floor(details.count), items.length)
      : items.length;
  return { count, items, whole: details.whole === true };
}

/** How an import that filled a new vault ended. */
export interface ImportEnding {
  /** Items it left out because they could not be imported, as the person chose. */
  leftOut: number;
  /** The person stopped it: the vault holds the files that got in, and opens like any other. */
  stopped: boolean;
}

/**
 * {@link ImportEnding} from an import's answer. A missing or odd `leftOut`
 * is none, and only `stopped: true` is a stop.
 */
export function parseImportEnding(answer: Record<string, unknown>): ImportEnding {
  const { leftOut } = answer;
  return {
    leftOut:
      typeof leftOut === "number" && Number.isFinite(leftOut)
        ? Math.max(0, Math.floor(leftOut))
        : 0,
    stopped: answer.stopped === true,
  };
}

/**
 * Blocked items found outside core, in the shape core answers with: `count`
 * of them (at least the ones given), the first
 * {@link IMPORT_BLOCKED_LIST_MAX} named in path order.
 */
export function importBlockedList(
  found: readonly ImportBlockedItem[],
  count: number,
  whole: boolean,
): ImportBlocked {
  const items = [...found]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .slice(0, IMPORT_BLOCKED_LIST_MAX);
  return { count: Math.max(count, found.length), items, whole };
}

/**
 * The `import_blocked` error for items found outside core (a phone's picked
 * folder). `whole` when the picked item itself is one.
 */
export function importBlockedError(found: readonly ImportBlockedItem[], whole: boolean): RpcError {
  return new RpcError(
    VAULT_ERROR_CODES.IMPORT_BLOCKED,
    `${found.length} items of the chosen file or folder cannot be imported`,
    importBlockedList(found, found.length, whole),
  );
}
