import type { AppLogFile, LogService } from "@upriv/shared";
import { rpcLogDelete, rpcLogEvent, rpcLogGet, rpcLogList } from "@/lib/rpc";

/**
 * Desktop → daemon `log_list` / `log_get` / `log_delete` / `log_event`.
 * Reads `.upriv/logs/` via Rust only (metadata list + on-demand content).
 */
export const desktopLogService: LogService = {
  async listFiles(): Promise<AppLogFile[]> {
    return rpcLogList();
  },

  async deleteFiles(filenames) {
    if (filenames.length === 0) return;
    await rpcLogDelete(filenames);
  },

  async getFile(filename) {
    return rpcLogGet(filename);
  },

  async recordVaultHidden() {
    await rpcLogEvent("vault_hidden");
  },
  async recordVaultGroupHidden() {
    await rpcLogEvent("vault_group_hidden");
  },
  async recordImportCacheWipeFailed() {
    await rpcLogEvent("import_cache_wipe_failed");
  },
};
