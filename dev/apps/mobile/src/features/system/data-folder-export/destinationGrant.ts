/**
 * The storage-access grant a picked export folder holds. The Data folder
 * window owns it while the vault list is up; an export only borrows it. Every folder this lets go of
 * reaches `release` once, and the service holds that back until an export
 * using the folder has ended.
 */
export interface DestinationGrant {
  held: () => string | null;
  /** A new folder replaces the held one; the same folder picked again is kept. */
  pick: (uri: string) => void;
  /** The vault list went away: let the folder go. */
  clear: () => void;
}

export function createDestinationGrant(release: (uri: string) => void): DestinationGrant {
  let held: string | null = null;
  return {
    held: () => held,
    pick(uri) {
      if (held && held !== uri) release(held);
      held = uri;
    },
    clear() {
      if (held) release(held);
      held = null;
    },
  };
}
