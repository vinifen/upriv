import type { AppLogFile, LogService } from "@upriv/shared";
import { rpcLogDelete, rpcLogGet, rpcLogList } from "@/lib/rpc";

/**
 * Desktop → daemon `log_list` / `log_get` / `log_delete`.
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
};
