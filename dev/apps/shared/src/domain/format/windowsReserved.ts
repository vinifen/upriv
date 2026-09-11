/**
 * True when `name` resolves to a Windows reserved device name
 * (`con`, `prn`, `aux`, `nul`, `com1..9`, `lpt1..9`), case-insensitive.
 * Extensions are ignored (`nul.txt` is reserved).
 */
export function isWindowsReservedName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const leaf = trimmed.split(/[\\/]/).pop() ?? trimmed;
  const withoutTrailing = leaf.replace(/[ .]+$/, "");
  if (!withoutTrailing) return false;
  const stem = withoutTrailing.split(".")[0]?.toUpperCase() ?? "";
  return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem);
}
