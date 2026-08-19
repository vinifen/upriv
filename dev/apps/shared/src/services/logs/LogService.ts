import type { AppLogFile } from "../../domain/logs";

export interface LogService {
  listFiles(): Promise<AppLogFile[]>;
  deleteFiles(filenames: readonly string[]): Promise<void>;
  getFile(filename: string): Promise<AppLogFile | undefined>;
  /** Session log line `vault_hidden` with no vault id or name. */
  recordVaultHidden(): Promise<void>;
}
