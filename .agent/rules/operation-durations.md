# Operation durations

How long Upriv waits for work, and what the person sees meanwhile. Desktop and mobile alike. The constants live in `@upriv/shared` `domain/loading/limits.ts`.

## Rules

1. **Work the person can stop has no time limit.** A job runs until it ends, fails, or is stopped: opening a vault, create, every import, the `.7z` password test, the file manager import, export, Back up now, backup export, Export data folder, Remove the folder, the password and unlock-RAM change, and the phone's copy of its private data folder. Its request carries a `newJobId()` id, its call timeout is `NO_DEADLINE_MS`, and Stop sends `job_cancel` with `by` (`user`, or `auto_close` for an auto-close with `when_busy = "close"`). A close has no limit either: Close now is its stop.
2. **Everything else has one limit**, `OPERATION_LIMIT_MS` (10 min), through `useOperationLimit`. When it passes, clear the busy state, bump the attempt's generation token (`busyGen` on Setup / Repair / Data folder / Alias recovery, `resolveGen` on the Gate), and show an error with Retry, so a late success changes nothing. The limit only ends a stuck wait: nothing on screen counts it down.
3. **No estimates, no countdowns.** Long work shows how long it has run (`ElapsedTime`, `useElapsed`, `formatElapsed`) from `LOADING_APPEAR_DELAY_MS` (1 s) on. Quick work shows its spinner or line from the same delay, so fast work never flashes one.
4. **Queued is its own state.** A job's `startedAt` stays `null` until `job_status` says core runs it: the row and the window say Queued and show no clock.
5. **Stop sits where the starting button was** (`JobStopButton`). One tap in a window; taps in its first `ROW_ROLE_GUARD_MS` are ignored, so the second half of a double tap never stops the job. The vault row's button takes two taps while `ui.lifecycle_confirm_stop` is on (`useRowArming`, `ROW_ARM_CONFIRM_AFTER_MS`, `ROW_ARM_WINDOW_MS`); `ui.lifecycle_confirm_lock` arms Lock the same way. Unlock never asks twice: it only opens its password window. A job in its last step refuses (`job_not_stoppable`): the row shows it as final and the window's Stop is disabled.
6. **Work outlives its window.** The vault list owns jobs (`useCoreJob`, `useVaultRewrapJob`, `useVaultPipelineRun`), so closing the window that started one keeps it running and reopening shows it. Vault settings and System settings saves finish after their window closes, report with a list toast, and show a failure again on reopen with the values that did not save.
7. **One timeout map.** `CORE_RPC_TIMEOUT_MS` in `@upriv/shared` holds every core method; desktop `METHOD_TIMEOUT_MS` adds the shell-only ones; Electron `daemonRpc` falls back to `DEFAULT_RPC_TIMEOUT_MS` (the same 10 min). `timeoutMs <= 0` means no deadline: jobs, closes, and the native pickers and install prompts that wait for the person.
8. **Quit and sleep.** The renderer reports running work to Electron main (`reportWork`). Quit asks while a job runs or waits; a normal quit waits for it; the quit dialog's Close now hurries every close and stops the daemon after `SHUTDOWN_NOW_TIMEOUT_MS` (30 s), and the next launch recovers what was left. An OS shutdown is Close now. While a job runs or a vault closes, the computer stays awake (`powerSaveBlocker`), and the phone too (`expo-keep-awake`, `useKeepAwakeWhile`).
9. **Auto-close meets running work** through the vault's `[auto_close] when_busy`: while files import into the file manager, `wait` (default) retries after they land, `close` stops the import and closes. An open or close of that vault is always waited for.

## Do not

- Put a time limit on a job, or a job id on work that cannot stop.
- Show a countdown, a "may take up to" line, or an estimate.
- Clear `busy` on the limit without bumping the generation token.
- Refuse to close a window because its work is running.
- Add an ad-hoc `setTimeout` limit in feature code — use `useOperationLimit`.
