import { useEffect, useMemo, useRef, useState } from "react";
import {
  isVaultFileManagerRetained,
  type VaultListItem,
  type VaultRowWork,
  type VaultRuntimePatch,
} from "@upriv/shared";
import { JOB_PROGRESS_POLL_MS } from "@upriv/shared/react";
import { nextQuitClose, publishQuitClose, type QuitCloseVault } from "@/lib/quitClose";
import { rpcVaultClosePhase } from "@/lib/rpc";
import { useDesktopEvent } from "@/lib/useDesktopEvent";

/** What the quit's close adds to the list status, so its rows show it. */
export interface QuitCloseRows {
  closingVaultIds: readonly string[];
  backingUpVaultIds: readonly string[];
  rowWork: Readonly<Record<string, VaultRowWork>>;
}

const NO_ROWS: QuitCloseRows = { closingVaultIds: [], backingUpVaultIds: [], rowWork: {} };

/** Vaults core holds open that the quit does not track yet, waiting for it. */
function vaultsToClose(
  vaults: readonly VaultListItem[],
  tracked: readonly QuitCloseVault[],
): QuitCloseVault[] {
  const known = new Set(tracked.map((vault) => vault.vaultId));
  return vaults
    .filter((vault) => isVaultFileManagerRetained(vault) && !known.has(vault.id))
    .map((vault) => ({
      vaultId: vault.id,
      name: vault.displayName,
      stage: "waiting",
      startedAt: null,
    }));
}

/**
 * The quit closes every open vault inside one `app_shutdown`, not through this
 * window's close queue, so no row would move. Once the quit starts, ask core how
 * each vault it closes stands (`vault_close_phase`, answered beside the quit):
 * the vaults open then, and any an open still running then unlocks. Show it on its row
 * (Closing…, Backing up…, then Closed), and publish it for the quit window.
 * Asking stops once every vault is closed; the app exits right after.
 */
export function useQuitCloseProgress(
  vaults: readonly VaultListItem[],
  setVaultRuntimeState: (vaultId: string, patch: VaultRuntimePatch) => void,
): QuitCloseRows {
  const [closes, setCloses] = useState<readonly QuitCloseVault[]>([]);
  const vaultsRef = useRef(vaults);
  vaultsRef.current = vaults;
  const closesRef = useRef(closes);
  closesRef.current = closes;
  const setRuntimeRef = useRef(setVaultRuntimeState);
  setRuntimeRef.current = setVaultRuntimeState;

  const [quitStarted, setQuitStarted] = useState(false);
  const quitStartedRef = useRef(false);

  useDesktopEvent("quit_closing", () => {
    if (quitStartedRef.current) return;
    quitStartedRef.current = true;
    const started = vaultsToClose(vaultsRef.current, []);
    closesRef.current = started;
    // Published at once, so the quit window's first frame already knows
    // whether any vault closes.
    publishQuitClose(started);
    setCloses(started);
    setQuitStarted(true);
  });

  // A normal quit first waits for running work, an open among it: the vault
  // that open unlocks is closed by the quit too, so it joins the list.
  useEffect(() => {
    if (!quitStarted) return;
    const added = vaultsToClose(vaults, closesRef.current);
    if (added.length === 0) return;
    const next = [...closesRef.current, ...added];
    closesRef.current = next;
    setCloses(next);
  }, [quitStarted, vaults]);

  const tracking = closes.length > 0 && closes.some((vault) => vault.stage !== "closed");

  useEffect(() => {
    if (!tracking) return;
    let active = true;
    let asking = false;
    const ask = async () => {
      if (asking) return;
      asking = true;
      try {
        const pending = closesRef.current.filter((vault) => vault.stage !== "closed");
        const answers = await Promise.all(
          pending.map((vault) => rpcVaultClosePhase(vault.vaultId).catch(() => null)),
        );
        if (!active) return;
        const now = Date.now();
        const byId = new Map(pending.map((vault, index) => [vault.vaultId, answers[index]]));
        // Only this poll changes the list once the quit started.
        const previous = closesRef.current;
        const next = previous.map((vault) =>
          nextQuitClose(vault, byId.get(vault.vaultId) ?? null, now),
        );
        closesRef.current = next;
        setCloses(next);
        next.forEach((vault, index) => {
          if (vault.stage === "closed" && previous[index]?.stage !== "closed") {
            setRuntimeRef.current(vault.vaultId, { session: null });
          }
        });
      } finally {
        asking = false;
      }
    };
    void ask();
    const timer = window.setInterval(() => void ask(), JOB_PROGRESS_POLL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [tracking]);

  useEffect(() => {
    publishQuitClose(closes);
  }, [closes]);

  return useMemo(() => {
    if (closes.length === 0) return NO_ROWS;
    const closing = closes.filter((vault) => vault.stage === "flush" || vault.stage === "backup");
    const rowWork: Record<string, VaultRowWork> = {};
    for (const vault of closing) {
      rowWork[vault.vaultId] = {
        startedAt: vault.startedAt,
        timed: true,
        stop: null,
        stoppingSince: null,
      };
    }
    return {
      closingVaultIds: closing.map((vault) => vault.vaultId),
      backingUpVaultIds: closing
        .filter((vault) => vault.stage === "backup")
        .map((vault) => vault.vaultId),
      rowWork,
    };
  }, [closes]);
}
