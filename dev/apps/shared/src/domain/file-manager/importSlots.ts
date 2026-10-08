/** How many files to read and encrypt at once. One core stays on one file. */
export function importFileSlots(cores: number, phone: boolean): number {
  const count = Number.isFinite(cores) ? Math.max(1, Math.floor(cores)) : 1;
  if (phone) return Math.min(2, Math.max(1, count - 1));
  return Math.min(4, Math.max(1, count - 2));
}

export function currentImportFileSlots(phone: boolean): number {
  const host = globalThis as { navigator?: { hardwareConcurrency?: number } };
  const cores = host.navigator?.hardwareConcurrency;
  return importFileSlots(typeof cores === "number" ? cores : 1, phone);
}
