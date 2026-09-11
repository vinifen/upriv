/** Outline classes for a vault-list drop target (`globals.css` `vault-list-drop-over*`). */
export function vaultListDropOverClass(isOver: boolean, blocked: boolean): string {
  if (!isOver) return "";
  return blocked ? "z-10 vault-list-drop-over-blocked" : "z-10 vault-list-drop-over";
}
