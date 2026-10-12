/** Vault name first, then each folder from the vault root, then the file name. */
export function pathBreadcrumbs(vaultName: string, path: string): string[] {
  return [vaultName, ...path.split("/").filter(Boolean)];
}

/**
 * Flex-shrink weight for crumb `index` of `count`. Earlier crumbs give up width first, so the
 * end of the path (the file name) stays readable longest.
 */
export function breadcrumbShrink(index: number, count: number): number {
  return 8 ** Math.min(Math.max(count - 1 - index, 0), 6);
}
