import type { VaultGroup } from "./types";

/**
 * Canonical empty group list for optional `groups` props and parameters.
 * Reuse this instead of a `groups = []` default: a fresh literal on every
 * render is a new identity, which busts `useMemo` / `memo` downstream.
 */
export const NO_VAULT_GROUPS: readonly VaultGroup[] = Object.freeze([]);
