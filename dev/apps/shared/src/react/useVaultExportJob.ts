import { useCallback } from "react";
import type { VaultExportFormat, VaultExportRequest, VaultRow } from "../domain";
import type { JobService, VaultPathWriteResult, VaultService } from "../services";
import { useCoreJob, type CoreJob } from "./useCoreJob";

/** What a vault export was started for. */
export interface VaultExportTarget {
  vaultId: string;
  displayName: string;
  format: VaultExportFormat;
}

/** The vault export in flight. */
export type VaultExportJob = CoreJob<VaultExportTarget>;

export interface VaultExportJobEvents {
  onExported: (result: VaultPathWriteResult, target: VaultExportTarget) => void;
  /** Includes a refused password, which the Export window marks on its field. */
  onFailed: (error: unknown, target: VaultExportTarget) => void;
  /** The export was stopped and left no file. */
  onCancelled: (target: VaultExportTarget) => void;
  /** Core refused the stop: the file is being put in place. */
  onStopRefused: (error: unknown, target: VaultExportTarget) => void;
}

/**
 * Vault export, owned by the vault list so it keeps running when the Export
 * window closes. One at a time. While `job` is set the list shows that vault
 * as `exporting` and refuses to open it.
 */
export function useVaultExportJob(
  vaultService: VaultService,
  jobs: JobService,
  events: VaultExportJobEvents,
) {
  const {
    job,
    start: startJob,
    stop,
  } = useCoreJob<VaultExportTarget, VaultPathWriteResult>(jobs, {
    onDone: (result, target) => events.onExported(result, target),
    onFailed: (error, target) => events.onFailed(error, target),
    onCancelled: (target) => events.onCancelled(target),
    onStopRefused: (error, target) => events.onStopRefused(error, target),
  });

  /** Export `vault` as `request` into `destDir`. False while an export runs. */
  const start = useCallback(
    (vault: VaultRow, request: VaultExportRequest, destDir: string): boolean =>
      startJob(
        { vaultId: vault.id, displayName: vault.displayName, format: request.format },
        (id) => vaultService.exportToFolder(vault, request, destDir, id),
      ),
    [startJob, vaultService],
  );

  return { job, start, stop };
}
