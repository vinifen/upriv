import { describe, expect, it } from "vitest";
import { NO_DEADLINE_MS, OPERATION_LIMIT_MS } from "../../loading/limits";
import { CORE_RPC_COMMANDS, MOBILE_ONLY_RPC_COMMANDS } from "../commands";
import {
  CORE_RPC_TIMEOUT_MS,
  MOBILE_ONLY_RPC_TIMEOUT_MS,
  vaultImportProbeTimeoutMs,
  vaultRootSetupPathTimeoutMs,
} from "../timeouts";

/** Requests that carry a `job` id the person can stop, and the close. */
const NO_DEADLINE = new Set<string>([
  CORE_RPC_COMMANDS.VAULT_CREATE,
  CORE_RPC_COMMANDS.VAULT_OPEN,
  CORE_RPC_COMMANDS.VAULT_PLAIN_CONFIRM,
  CORE_RPC_COMMANDS.VAULT_PLAIN_REMOVE,
  CORE_RPC_COMMANDS.VAULT_CLOSE,
  CORE_RPC_COMMANDS.VAULT_CHANGE_PASSWORD,
  CORE_RPC_COMMANDS.VAULT_CHANGE_KDF,
  CORE_RPC_COMMANDS.VAULT_REBUILD,
  CORE_RPC_COMMANDS.VAULT_EXPORT,
  CORE_RPC_COMMANDS.VAULT_IMPORT_ZIP,
  CORE_RPC_COMMANDS.VAULT_IMPORT_7Z,
  CORE_RPC_COMMANDS.VAULT_IMPORT_FILES_ZIP,
  CORE_RPC_COMMANDS.VAULT_IMPORT_OS_PATH,
  CORE_RPC_COMMANDS.VAULT_FS_IMPORT_OS_FILE,
  CORE_RPC_COMMANDS.BACKUP_SAVE,
  CORE_RPC_COMMANDS.BACKUP_EXPORT,
  CORE_RPC_COMMANDS.DATA_FOLDER_EXPORT,
]);

describe("CORE_RPC_TIMEOUT_MS", () => {
  it("gives jobs and the close no deadline, and every other call the one limit", () => {
    for (const method of Object.values(CORE_RPC_COMMANDS)) {
      const expected = NO_DEADLINE.has(method) ? NO_DEADLINE_MS : OPERATION_LIMIT_MS;
      expect(CORE_RPC_TIMEOUT_MS[method], method).toBe(expected);
    }
    for (const method of Object.values(MOBILE_ONLY_RPC_COMMANDS)) {
      expect(MOBILE_ONLY_RPC_TIMEOUT_MS[method], method).toBe(OPERATION_LIMIT_MS);
    }
  });

  it("runs a .7z password test as a job and reads a zip at once", () => {
    expect(vaultImportProbeTimeoutMs({ kind: "seven_zip" })).toBe(NO_DEADLINE_MS);
    expect(vaultImportProbeTimeoutMs({ kind: "7z" })).toBe(NO_DEADLINE_MS);
    expect(vaultImportProbeTimeoutMs({ archivePath: "/tmp/notes.7z" })).toBe(NO_DEADLINE_MS);
    expect(vaultImportProbeTimeoutMs({ kind: "store_zip", archivePath: "/tmp/notes.7z" })).toBe(
      OPERATION_LIMIT_MS,
    );
  });

  it("runs a phone's copy of its data folder as a job", () => {
    expect(vaultRootSetupPathTimeoutMs({ adoptPrivateRoot: true })).toBe(NO_DEADLINE_MS);
    expect(vaultRootSetupPathTimeoutMs({})).toBe(OPERATION_LIMIT_MS);
  });
});
