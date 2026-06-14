/** Create-vault wizard platform hooks (import archive probe, mock paths). */
export interface CreateVaultService {
  testImportArchivePassword(password: string): boolean;
  getMockImportArchivePath(): string;
  getMockImportArchiveFileName(): string;
}
