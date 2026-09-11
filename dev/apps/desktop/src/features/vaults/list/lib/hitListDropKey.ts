import { pickListDropTarget } from "@upriv/shared";
import { VAULT_LIST_DROP_KEY } from "./listDropKey";

export function hitVaultListDropKey(clientX: number, clientY: number, sourceKey: string | null) {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    const host = (el as HTMLElement).closest?.(`[${VAULT_LIST_DROP_KEY}]`);
    if (!host) continue;
    const key = host.getAttribute(VAULT_LIST_DROP_KEY);
    if (!key || key === sourceKey || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return pickListDropTarget(keys, sourceKey);
}
