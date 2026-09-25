/** Create-vault wizard platform hooks (import package probe). */
export interface CreateVaultService {
  /** Resolves `false` for a wrong password — probing is not an error path. */
  testImportPackagePassword(
    password: string,
    importFile?: { path: string; fileName: string; kind?: "file" | "backup" },
  ): Promise<boolean>;
  /** Native file picker. Resolves `null` when the user cancels. */
  selectImportPackageForProbe(): Promise<{ path: string; fileName: string } | null>;
}
