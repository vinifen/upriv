import { useCallback, useEffect, useState } from "react";
import type { FileTreeNode } from "../domain";
import type { VaultFileSystemService } from "../services";

type FileTreeLoadStatus = "loading" | "ready" | "error";

const EMPTY_FILE_TREE: FileTreeNode = { name: "", type: "folder", children: [] };

/**
 * Explorer tree for one vault, refetched whenever `revision` changes.
 *
 * `status` stays `loading` only until the first answer for this vault. Later
 * refetches (after a save, rename, import) keep the current tree on screen,
 * even when one of them fails.
 * The list RPC has a finite timeout, so `loading` always ends in `ready` or `error`.
 */
export function useVaultFileTree(
  fs: Pick<VaultFileSystemService, "getFileTree">,
  vaultId: string,
  revision: number,
) {
  const [tree, setTree] = useState<FileTreeNode>(EMPTY_FILE_TREE);
  const [settled, setSettled] = useState<{ vaultId: string; failed: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fs.getFileTree(vaultId).then(
      (next) => {
        if (cancelled) return;
        setTree(next);
        setSettled({ vaultId, failed: false });
      },
      () => {
        if (cancelled) return;
        setSettled((prev) =>
          prev?.vaultId === vaultId && !prev.failed ? prev : { vaultId, failed: true },
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fs, vaultId, revision, attempt]);

  const retry = useCallback(() => {
    setSettled(null);
    setAttempt((current) => current + 1);
  }, []);

  const status: FileTreeLoadStatus =
    settled?.vaultId !== vaultId ? "loading" : settled.failed ? "error" : "ready";

  return { tree, setTree, status, retry };
}
