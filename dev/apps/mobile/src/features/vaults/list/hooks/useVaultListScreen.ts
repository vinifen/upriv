import { useVaultListModals } from "./useVaultListModals";
import { useVaultListState } from "./useVaultListState";

export function useVaultListScreen(
  persistedSearch: string,
  patchSettings: (patch: { ui: { vault_list_search: string } }) => Promise<unknown>,
) {
  const state = useVaultListState(persistedSearch, patchSettings);
  const modals = useVaultListModals();
  return { state, modals };
}
