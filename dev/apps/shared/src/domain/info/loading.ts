import type { InfoField } from "./types";

/**
 * A row whose value is still being read. Each value of an Info window
 * arrives on its own, so a slow one never holds the others back.
 */
export function loadingField(id: string, label: string): InfoField {
  return { id, label, value: "", loading: true };
}
