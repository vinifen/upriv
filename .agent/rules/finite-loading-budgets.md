# Finite loading budgets (visible to the user)

## Hard rule

Every **blocking** loading / busy / applying overlay in the desktop (and later mobile) UI must:

1. Use a **finite** timeout from `LOADING_BUDGET_MS` in `@upriv/shared` (`domain/loading/budget.ts`) — keep Electron invoke timeouts in sync for the same operation.
2. **Show** the budget to the user (`LoadingBudgetHint` + `useLoadingBudget`): max duration **and** countdown remaining, so the wait never looks endless.
3. Delay first paint via `useLoadingBudget().visible` — `LOADING_APPEAR_DELAY_MS` (1s) for short budgets; `LOADING_LONG_HINT_APPEAR_DELAY_MS` (10s) for 10-minute budgets so "up to 10 min" does not scare on a fast unlock. Budget/timeout still count from when the op started. Open modal + row share `pipeline.run.startedAt`.
4. On timeout: **clear** the spinner / applying / `busy` state and offer **retry** (or a clear error). Never leave `applying` / `busy` stuck forever.
5. Also **invalidate** the in-flight attempt: bump a generation token (`busyGen` on Setup / Repair / Data folder / Alias recovery; `resolveGen` on Gate applying) so a late RPC success cannot re-apply root / `setReady` / clear the timeout error.
6. Work core runs as a **job** (`vault_export`, `backup_save`, `backup_export`, `data_folder_export`, `vault_plain_remove`, each with a `newJobId` id) is also **stopped in core** on timeout: send `job_cancel` for that id, so core does not keep holding the vault or writing the file after the UI gave up. `useCoreJob` does this for all of them. The call's own `rpc_timeout` (`isRpcTimeout`) sends `job_cancel` too.
7. Work whose time follows the bytes it moves is **sized**: its `LOADING_BUDGET_MS` entry is the floor, and `sizedBudgetMs` in `domain/loading/sizedBudget.ts` grows it (floor + bytes × passes at `SLOW_DISK_BYTES_PER_SECOND`, at most `SIZED_BUDGET_CEILING_MS`, 12 h). Core reports the bytes: `job_status` for a job, `vault_close_phase` for a close, `vault_store_size` before a rewrap. The call timeout of work sized while it runs is that ceiling (`CORE_RPC_TIMEOUT_MS`), so the visible budget ends the wait first and a large vault is never cut off by a fixed number. A new sized operation gets one `SIZED_WORK` entry; do not add a second formula.
8. Electron **main** must honor the same map: renderer passes `METHOD_TIMEOUT_MS[method]` (CORE values from `@upriv/shared` `CORE_RPC_TIMEOUT_MS`, plus the `SHELL_ONLY_RPC_COMMANDS` entries in `invoke.ts`) through preload into `daemonRpc` (unmapped methods fall back to 30s — do not leave long vault-root ops on that default). Electron main sends `app_shutdown` with its own `SHUTDOWN_TIMEOUT_MS`, or `SHUTDOWN_NOW_TIMEOUT_MS` for the quit dialog's Close now.

## Budgets (current)

| Key | Default | Use |
|-----|---------|-----|
| `vaultRoot` | 10 min | Data-folder setup / Repair / ConfirmFooter busy |
| `vaultRootResolve` | 1 min | Gate applying while waiting on `vault_root_resolve` |
| `settingsLoad` | 1 min | First settings load overlay |
| `logs` | 1 min | Logs list / viewer |
| `vaultRewrap` | 10 min | Vault settings password / KDF change. Floor: sized from `store/` before the call, which carries that budget as its timeout. |
| `vaultCreate` | 20 min | Vault create in the pipeline queue (Argon2id wrap + seed), and the zip / `.7z` / OS-file imports that create a vault |
| `vaultPipeline` | 10 min | Open/close progress (password modal if open + row hint; Argon2id unlock + flush), and the saves behind an unsaved-changes prompt. A close grows from this floor once core measures its backup (`waitForClose`). |
| `vaultExport` | 60 min | Floor. Export zip of `store/`, portable `.7z`, or plain-text `.zip` (`vault_export`). The Export window shows progress from `job_status`. On timeout the list asks core to stop that job (`job_cancel`), whether the window is open or not, which removes the partial file, overwriting a plain-text one first. |
| `vaultBackupSave` | 10 min | Floor. Backups → Back up now (`backup_save`): zip of the closed `store/` into `backups/saves/`. On timeout the UI asks core to stop that job (`job_cancel`). |
| `backupExport` | 60 min | Floor. Backups → Export (`backup_export`): one backup zip, or a bundle of several, into the chosen folder. Progress from `job_status`, in the row or above the Saves list. On timeout the job asks core to stop (`job_cancel`), which removes the partial file. |
| `dataFolderExport` | 60 min | Floor. Export data folder (`data_folder_export`): zip of the whole `.upriv`. Progress from `job_status`. On timeout the job asks core to stop (`job_cancel`), which removes the partial zip. |
| `plainLeftoverRemove` | 10 min | Floor. Recovery → Remove the folder (`vault_plain_remove`): the window closes at once, and the row shows `recovering` with this budget, sized from the folder's bytes. On timeout the job asks core to stop (`job_cancel`); what it did not reach stays, and the vault stays in recovery. |
| `vaultFsImport` | 10 min | In-app FM OS drop / picker. Explorer skeletons at the drop target (appear immediately). Editor loading + countdown only for the file currently being written (`LOADING_APPEAR_DELAY_MS`, that write's `startedAt`) — queued files in the same batch do not show the 10 min clock. Overlapping drops are allowed (one session per batch). Close and cancel stops queued files; the write already in flight still finishes (do not gen-kill a late successful write). On RPC/invoke failure drop the remaining skeletons for that batch. |
| `vaultRename` | 2 min | Deep vault rename (`vault_rename` folder + id remap) |
| `settingsSave` | 30 s | Settings Save / workspace path persist (`app_settings_save`) |
| `vaultDelete` | 10 min | Delete a closed or recovery vault (`vault_delete`). Not `settingsSave`. |
| `quitCloseNow` | 30 s | The quit dialog's Close now (`app_shutdown` with `now`). Electron `SHUTDOWN_NOW_TIMEOUT_MS` holds the same value and stops the daemon when it runs out; the next launch recovers what was left. |
| `default` | 2 min | Generic modal / list work |

Do **not** swap `vaultRoot` and `vaultRootResolve` — setup/repair can be huge; resolve probe must fail sooner.

Prefer a larger budget over an infinite wait. “Massive” is OK; infinite is not.

## `timeoutMs: 0`

Contract (renderer `invoke` + Electron `daemonRpc`): `timeoutMs <= 0` means **no deadline**. Use only for native dialogs that wait on the user (e.g. `pick_directory`). Never use `0` for vault-root busy / applying overlays — those must stay on `LOADING_BUDGET_MS`.

## Do not

- Ship a full-screen or modal spinner with no remaining-time copy.
- Soft-block the Gate (`applying`) without a budget + timeout recovery + `resolveGen` bump.
- Clear `busy` on timeout without bumping `busyGen` (late success would still run UI side effects).
- Invent ad-hoc `setTimeout` budgets in feature code — extend `LOADING_BUDGET_MS` instead.
