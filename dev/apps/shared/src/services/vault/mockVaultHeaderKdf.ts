import { DEFAULT_KDF_UNLOCK_PRESET, type KdfUnlockPreset } from "../../domain/vault-settings/kdf";

/** Mock `contents/vault.header` unlock preset — not persisted in `config.toml`. */
const RUNTIME_PRESETS = new Map<string, KdfUnlockPreset>();

const SEEDED_PRESETS: Record<string, KdfUnlockPreset> = {
  "my-encrypted-notes": "256mib",
  "vault-example-2": "256mib",
  "cold-storage": "1gib",
  "finance-2025": "256mib",
  "travel-planner": "256mib",
  "plain-folder-demo": "256mib",
  "encrypted-dir-demo": "256mib",
  "upriv-plain-demo": "256mib",
  "old-archive": "256mib",
};

/** Always returns a preset — every vault header has unlock cost (default if unseeded). */
export function getMockVaultUnlockPreset(vaultId: string): KdfUnlockPreset {
  const runtime = RUNTIME_PRESETS.get(vaultId);
  if (runtime) return runtime;
  return SEEDED_PRESETS[vaultId] ?? DEFAULT_KDF_UNLOCK_PRESET;
}

export function setMockVaultUnlockPreset(vaultId: string, preset: KdfUnlockPreset): void {
  RUNTIME_PRESETS.set(vaultId, preset);
}

export function clearMockVaultUnlockPreset(vaultId: string): void {
  RUNTIME_PRESETS.delete(vaultId);
}

/** Create-vault mock: persist the unlock preset chosen (or default) into the header map. */
export function seedMockVaultUnlockPreset(
  vaultId: string,
  preset: KdfUnlockPreset = DEFAULT_KDF_UNLOCK_PRESET,
): void {
  setMockVaultUnlockPreset(vaultId, preset);
}
