import type { VaultPipelineKind } from "./kinds";

/** Active open run or a queued open job — resume unlock credential UI. */
export function isVaultOpenJobPending(
  vaultId: string,
  active: { vaultId: string; kind: VaultPipelineKind } | null | undefined,
  queued: readonly { vaultId: string; kind: VaultPipelineKind }[],
): boolean {
  if (active?.vaultId === vaultId && active.kind === "open") return true;
  return queued.some((job) => job.vaultId === vaultId && job.kind === "open");
}
