/** Mock password accepted by `mockTestArchivePassword` (dev UI until Tauri + 7zz). */
export const MOCK_ARCHIVE_PASSWORD = "demo";

export const MOCK_IMPORT_ARCHIVE_PATH = "/home/user/Downloads/My Archive.7z";

export function mockTestArchivePassword(password: string): boolean {
  return password === MOCK_ARCHIVE_PASSWORD;
}
