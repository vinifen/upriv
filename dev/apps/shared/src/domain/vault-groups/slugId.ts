/**
 * Vault / group slug ids — mirrors Rust `slug_id_is_valid`:
 * `[a-z0-9-]+`, 1–64, no leading/trailing hyphen, not a Windows reserved name.
 */
const WINDOWS_RESERVED = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

export function slugIdIsValid(id: string): boolean {
  if (!id || id.length > 64) return false;
  if (id.startsWith("-") || id.endsWith("-")) return false;
  if (!/^[a-z0-9-]+$/.test(id)) return false;
  return !WINDOWS_RESERVED.has(id);
}
