/** A file core wrote into a folder the person chose: where it is, and its size. */
export interface VaultPathWriteResult {
  path: string;
  size: number;
}

export function parsePathWriteResult(raw: unknown): VaultPathWriteResult | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as { path?: unknown; size?: unknown };
  if (typeof record.path !== "string" || typeof record.size !== "number") return null;
  return { path: record.path, size: record.size };
}
