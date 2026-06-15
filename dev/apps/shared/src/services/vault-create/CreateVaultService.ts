/** Create-vault wizard platform hooks (import archive probe). */
export interface CreateVaultService {
  testImportArchivePassword(password: string): boolean;
  /** Browser dev placeholder until native file picker is wired. */
  selectImportArchiveForProbe(): { path: string; fileName: string };
}
