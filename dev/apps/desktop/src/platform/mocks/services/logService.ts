import type { AppLogFile, LogService } from "@upriv/shared";
import { getMockLogFile, getMockLogFiles } from "@/platform/mocks/data/logs";

let runtimeFiles: AppLogFile[] | null = null;

function files(): AppLogFile[] {
  if (!runtimeFiles) {
    runtimeFiles = getMockLogFiles().map((entry) => ({ ...entry }));
  }
  return runtimeFiles;
}

/** Prototype log service — in-memory until Tauri reads `.upriv/logs/`. */
export const mockLogService: LogService = {
  async listFiles() {
    return files().map((entry) => ({ ...entry }));
  },

  async deleteFiles(filenames) {
    if (filenames.length === 0) return;
    const current = files();
    const blocked = filenames.filter((filename) =>
      current.some((entry) => entry.filename === filename && entry.isCurrent),
    );
    if (blocked.length > 0) {
      throw new Error("cannot_delete_current_log");
    }
    const remove = new Set(filenames);
    runtimeFiles = current.filter((entry) => !remove.has(entry.filename));
  },

  async getFile(filename) {
    const entry = files().find((item) => item.filename === filename);
    if (entry) return { ...entry };
    return getMockLogFile(filename);
  },
};
