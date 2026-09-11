import type { CreateVaultService } from "@upriv/shared";

const MOCK_IMPORT_PASSWORD = "demo";
const MOCK_IMPORT_PATH = "/home/user/Downloads/My Notes.zip";
const MOCK_IMPORT_FILE_NAME = "My Notes.zip";
/** Stands in for the upriv-core header probe round-trip. */
const MOCK_IMPORT_PASSWORD_TEST_MS = 400;

/** Prototype create-vault service until desktop RPC + import probe is wired. */
export const mockCreateVaultService: CreateVaultService = {
  async testImportPackagePassword(password) {
    await new Promise((resolve) => setTimeout(resolve, MOCK_IMPORT_PASSWORD_TEST_MS));
    return password === MOCK_IMPORT_PASSWORD;
  },

  selectImportPackageForProbe() {
    return {
      path: MOCK_IMPORT_PATH,
      fileName: MOCK_IMPORT_FILE_NAME,
    };
  },
};
