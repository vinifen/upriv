export function vaultRootPathKey(path: string): string {
  return path.trim().replace(/[/\\]+$/g, "");
}

export function sameVaultRootPath(a: string, b: string): boolean {
  return vaultRootPathKey(a) === vaultRootPathKey(b);
}
