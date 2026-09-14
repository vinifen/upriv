import type { VaultListItem } from "./types";

function keepLocalSession(row: VaultListItem, previous: VaultListItem): VaultListItem {
  return {
    ...row,
    session: previous.session,
    lastAccessedAt: previous.lastAccessedAt || row.lastAccessedAt,
    lastAccessedWhen: previous.lastAccessedWhen || row.lastAccessedWhen,
  };
}

/**
 * Apply a `vault_list` snapshot without letting a stale fetch overwrite a
 * newer local session write (open / closing / last-accessed).
 *
 * `closed` in the UI is `session == null` plus no in-flight pipeline. A late
 * list that still says "closed" after we opened (or "open" after we closed)
 * must not win if the runtime patch happened after that fetch started.
 *
 * Core never reports `closing` — only `open` or null. While the renderer is
 * flushing, keep local `closing` against a fresh list that still says `open`
 * **or** already says null (session removed in core before flush finishes).
 * Local last-accessed after unlock is also newer than disk `last_close_ok_at`.
 */
export function mergeVaultListSnapshot(
  current: readonly VaultListItem[],
  incoming: readonly VaultListItem[],
  sessionWrites: ReadonlyMap<string, number>,
  fetchStartedAt: number,
): VaultListItem[] {
  const currentById = new Map(current.map((vault) => [vault.id, vault]));
  const incomingIds = new Set(incoming.map((row) => row.id));

  const merged = incoming.map((row) => {
    const previous = currentById.get(row.id);
    if (!previous) return row;

    // Renderer-only `closing` must survive until `revealClosed`, regardless of
    // whether core still reports open or has already dropped the session.
    if (previous.session === "closing" && row.session !== "closing") {
      return keepLocalSession(row, previous);
    }

    if (previous.session === "open" && row.session === "open") {
      return {
        ...row,
        lastAccessedAt: previous.lastAccessedAt || row.lastAccessedAt,
        lastAccessedWhen: previous.lastAccessedWhen || row.lastAccessedWhen,
      };
    }

    const writtenAt = sessionWrites.get(row.id) ?? 0;
    if (writtenAt <= fetchStartedAt) return row;

    if (previous.session === "open" || previous.session === "closing") {
      return keepLocalSession(row, previous);
    }
    return { ...row, session: previous.session };
  });

  for (const previous of current) {
    if (incomingIds.has(previous.id)) continue;
    const writtenAt = sessionWrites.get(previous.id) ?? 0;
    if (writtenAt > fetchStartedAt) {
      merged.push(previous);
    }
  }

  return merged;
}
