import type { ExportFolderGrants } from "@upriv/shared";

/**
 * The one picked folder an export field keeps, as a hold on its
 * storage-access grant. Another pick replaces it; the same folder picked
 * again is kept as it is.
 */
export interface ExportFolderHold {
  held: () => string | null;
  /** The picker answered with `uri` for this field. */
  pick: (uri: string) => void;
  /** The picker answered after the field stopped waiting: the folder is not kept. */
  drop: (uri: string) => void;
  /** The field went away: let its folder go. */
  clear: () => void;
}

/** Without `grants` (no storage access) the field only remembers the folder. */
export function createExportFolderHold(grants: ExportFolderGrants | undefined): ExportFolderHold {
  let held: string | null = null;
  return {
    held: () => held,
    pick(uri) {
      if (uri === held) return;
      grants?.hold(uri);
      if (held) grants?.release(held);
      held = uri;
    },
    drop(uri) {
      if (uri !== held) grants?.release(uri);
    },
    clear() {
      if (held) grants?.release(held);
      held = null;
    },
  };
}
