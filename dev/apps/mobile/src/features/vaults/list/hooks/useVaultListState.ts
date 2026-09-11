import { useCallback, useEffect, useRef, useState } from "react";
import { View, type GestureResponderEvent } from "react-native";
import {
  normalizeVaultListSearch,
  VAULT_LIST_SEARCH_PERSIST_MS,
  type VaultGroup,
  type VaultListItem,
} from "@upriv/shared";
import type { VaultListSearchHandle } from "../VaultListSearch";

export function useVaultListState(
  persistedSearch: string,
  patchSettings: (patch: { ui: { vault_list_search: string } }) => Promise<unknown>,
) {
  const [listSearch, setListSearch] = useState(() => normalizeVaultListSearch(persistedSearch));
  const knownPersistedSearch = useRef(normalizeVaultListSearch(persistedSearch));
  const listSearchRef = useRef(listSearch);
  listSearchRef.current = listSearch;
  const vaultListSearchRef = useRef<VaultListSearchHandle>(null);

  useEffect(() => {
    const incoming = normalizeVaultListSearch(persistedSearch);
    if (incoming === knownPersistedSearch.current) return;
    if (listSearchRef.current === knownPersistedSearch.current) {
      setListSearch(incoming);
    }
    knownPersistedSearch.current = incoming;
  }, [persistedSearch]);

  useEffect(() => {
    const next = normalizeVaultListSearch(listSearch);
    if (next === knownPersistedSearch.current) return;
    const timer = setTimeout(() => {
      knownPersistedSearch.current = next;
      void patchSettings({ ui: { vault_list_search: next } });
    }, VAULT_LIST_SEARCH_PERSIST_MS);
    return () => clearTimeout(timer);
  }, [listSearch, patchSettings]);

  useEffect(() => {
    return () => {
      const next = normalizeVaultListSearch(listSearchRef.current);
      if (next === knownPersistedSearch.current) return;
      knownPersistedSearch.current = next;
      void patchSettings({ ui: { vault_list_search: next } });
    };
  }, [patchSettings]);

  const blurVaultListSearchIfOutside = useCallback((event: GestureResponderEvent) => {
    const { pageX, pageY } = event.nativeEvent;
    vaultListSearchRef.current?.measureShellInWindow((x, y, width, height) => {
      if (width <= 0 || height <= 0) return;
      if (pageX < x || pageX > x + width || pageY < y || pageY > y + height) {
        vaultListSearchRef.current?.blur();
      }
    });
  }, []);

  const [vaults, setVaults] = useState<VaultListItem[]>([]);
  const [groups, setGroups] = useState<VaultGroup[]>([]);
  const [groupsInvalid, setGroupsInvalid] = useState(false);
  const [groupsInvalidDismissed, setGroupsInvalidDismissed] = useState(false);
  const [groupsSanitizeNotice, setGroupsSanitizeNotice] = useState<{
    orphans: number;
    duplicates: number;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragOverIdRef = useRef<string | null>(null);
  const [dragPointer, setDragPointer] = useState<{ x: number; y: number } | null>(null);
  const [dragScrollLock, setDragScrollLock] = useState(false);
  const dropViewsRef = useRef(new Map<string, View>());
  const dropRectsRef = useRef(new Map<string, { x: number; y: number; w: number; h: number }>());

  return {
    listSearch,
    setListSearch,
    vaultListSearchRef,
    blurVaultListSearchIfOutside,
    vaults,
    setVaults,
    groups,
    setGroups,
    groupsInvalid,
    setGroupsInvalid,
    groupsInvalidDismissed,
    setGroupsInvalidDismissed,
    groupsSanitizeNotice,
    setGroupsSanitizeNotice,
    refreshing,
    setRefreshing,
    draggingId,
    setDraggingId,
    draggingIdRef,
    dragOverId,
    setDragOverId,
    dragOverIdRef,
    dragPointer,
    setDragPointer,
    dragScrollLock,
    setDragScrollLock,
    dropViewsRef,
    dropRectsRef,
  };
}
