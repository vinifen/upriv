import type { AppLogFile, LogService } from "@upriv/shared";

/** Minimal in-memory Logs stub for browser / non-Electron scaffolds.
 * Desktop Electron uses `desktopLogService` (live `log_*` RPC). */
export const mockLogService: LogService = {
  async listFiles() {
    return [] as AppLogFile[];
  },

  async deleteFiles() {
    // no-op
  },

  async getFile() {
    return undefined;
  },

  async recordVaultHidden() {
    // Browser scaffold has no session log files.
  },
  async recordVaultGroupHidden() {
    // Browser scaffold has no session log files.
  },
  async recordImportCacheWipeFailed() {
    // Browser scaffold has no session log files.
  },
};
