/** Touch last-accessed fields after unlock/open (mock until Tauri returns relative labels). */
export function touchVaultLastAccessed(when: string): {
  lastAccessedAt: string;
  lastAccessedWhen: string;
} {
  return {
    lastAccessedAt: new Date().toISOString(),
    lastAccessedWhen: when,
  };
}
