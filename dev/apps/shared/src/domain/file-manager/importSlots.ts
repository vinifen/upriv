/** How many files to read and encrypt at once. One core stays on one file. */
export function importFileSlots(cores: number, phone: boolean): number {
  const count = Number.isFinite(cores) ? Math.max(1, Math.floor(cores)) : 1;
  if (phone) return Math.min(2, Math.max(1, count - 1));
  return Math.min(4, Math.max(1, count - 2));
}
