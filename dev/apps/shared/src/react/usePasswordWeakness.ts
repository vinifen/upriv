import { useMemo } from "react";
import { findPasswordWeakness, type PasswordWeakness } from "../domain";

/**
 * What is objectively wrong with `password`, `null` when nothing is or the field
 * is empty. Recomputed only when an argument changes, so pass a `vaultText`
 * that keeps its identity between renders (memoize it).
 */
export function usePasswordWeakness(
  password: string,
  vaultText: readonly string[],
  currentPassword = "",
): PasswordWeakness | null {
  return useMemo(
    () => findPasswordWeakness(password, vaultText, currentPassword),
    [password, vaultText, currentPassword],
  );
}
