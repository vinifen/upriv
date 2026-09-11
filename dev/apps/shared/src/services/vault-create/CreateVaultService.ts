/** Create-vault wizard platform hooks (import package probe). */
export interface CreateVaultService {
  /** Resolves `false` for a wrong password — probing is not an error path. */
  testImportPackagePassword(password: string): Promise<boolean>;
  /** Browser dev placeholder until native file picker is wired. */
  selectImportPackageForProbe(): { path: string; fileName: string };
}
