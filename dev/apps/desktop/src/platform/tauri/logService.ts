import type { AppLogFile, LogService } from "@upriv/shared";
import { logCreatedAtFromFilename } from "@upriv/shared";
import { TAURI_COMMANDS, tauriInvoke } from "@/lib/tauri";
import { resolveVaultRootPath } from "./vaultRoot";

interface LogFileDto {
  filename: string;
  seq: number;
  isCurrent: boolean;
  createdAt: string;
  sizeBytes: number;
  lineCount: number;
  content: string;
}

function mapLogFile(dto: LogFileDto): AppLogFile {
  return {
    filename: dto.filename,
    seq: dto.seq,
    isCurrent: dto.isCurrent,
    createdAt: dto.createdAt || logCreatedAtFromFilename(dto.filename) || new Date().toISOString(),
    sizeBytes: dto.sizeBytes,
    lineCount: dto.lineCount,
    content: dto.content,
  };
}

export function createTauriLogService(): LogService {
  return {
    async listFiles() {
      const vaultRoot = await resolveVaultRootPath();
      const rows = await tauriInvoke<LogFileDto[]>(TAURI_COMMANDS.LOG_LIST, { vaultRoot });
      return rows.map(mapLogFile);
    },

    async deleteFiles(filenames) {
      if (filenames.length === 0) return;
      const vaultRoot = await resolveVaultRootPath();
      await tauriInvoke(TAURI_COMMANDS.LOG_DELETE, {
        vaultRoot,
        filenames: [...filenames],
      });
    },

    async getFile(filename) {
      const vaultRoot = await resolveVaultRootPath();
      try {
        const dto = await tauriInvoke<LogFileDto>(TAURI_COMMANDS.LOG_GET, {
          vaultRoot,
          filename,
        });
        return mapLogFile(dto);
      } catch {
        return undefined;
      }
    },
  };
}
