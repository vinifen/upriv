import { vaultRowFixture } from "../../vault/tests/fixtures.shared";
import type { VaultListItem } from "..";

export function vaultListItemFixture(overrides: Partial<VaultListItem> = {}): VaultListItem {
  return {
    ...vaultRowFixture(overrides),
    lastAccessedWhen: "just now",
    lastAccessedAt: "2026-06-01T12:00:00.000Z",
    note: "",
    ...overrides,
  };
}
