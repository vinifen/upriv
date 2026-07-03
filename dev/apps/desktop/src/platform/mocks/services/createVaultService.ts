import type { CreateVaultService } from "@upriv/shared";

const MOCK_ARCHIVE_PASSWORD = "demo";
const MOCK_IMPORT_ARCHIVE_PATH = "/home/user/Downloads/My Archive.7z";
const MOCK_IMPORT_ARCHIVE_FILE_NAME = "My Archive.7z";

/** Prototype create-vault service until desktop RPC + 7zz import probe is wired. */
export const mockCreateVaultService: CreateVaultService = {
  testImportArchivePassword(password) {
    return password === MOCK_ARCHIVE_PASSWORD;
  },

  selectImportArchiveForProbe() {
    return {
      path: MOCK_IMPORT_ARCHIVE_PATH,
      fileName: MOCK_IMPORT_ARCHIVE_FILE_NAME,
    };
  },
};
