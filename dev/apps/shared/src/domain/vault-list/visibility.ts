/** Vaults shown in the list and pickers. */
export function filterVisibleVaults<T extends { hidden?: boolean }>(
  vaults: readonly T[],
  showHiddenVaults: boolean,
): T[] {
  if (showHiddenVaults) return [...vaults];
  return vaults.filter((vault) => !vault.hidden);
}
