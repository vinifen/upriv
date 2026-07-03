import { TAURI_COMMANDS, tauriInvoke } from "@/lib/tauri";

/** Active vault-root path for Tauri → upriv-core commands. */
let vaultRootPath: string | null = null;

/** Set from app settings or `UPRIV_VAULT_ROOT` (Tauri only). */
export function setVaultRootPath(path: string | null): void {
  const trimmed = path?.trim();
  vaultRootPath = trimmed ? trimmed : null;
}

export function getVaultRootPath(): string | null {
  return vaultRootPath;
}

const VAULT_ROOT_NOT_CONFIGURED =
  "Vault root not configured. Set UPRIV_VAULT_ROOT or choose a folder in System settings.";

async function cacheVaultRoot(path: string): Promise<string> {
  vaultRootPath = path.trim();
  return vaultRootPath;
}

async function isUsableRoot(path: string): Promise<boolean> {
  try {
    return await validateVaultRootPath(path);
  } catch {
    return false;
  }
}

/** Resolve vault-root: cached settings path, then app-local path, then `UPRIV_VAULT_ROOT`. */
export async function resolveVaultRootPath(): Promise<string> {
  if (vaultRootPath) {
    return vaultRootPath;
  }

  // Persisted sources can go stale (drive unplugged, structure removed) — only
  // accept them when they still point at a real Upriv root.
  const fromAppLocal = await tauriInvoke<string | null>(TAURI_COMMANDS.APP_VAULT_ROOT_PATH_GET);
  if (fromAppLocal?.trim() && (await isUsableRoot(fromAppLocal))) {
    return cacheVaultRoot(fromAppLocal);
  }

  const fromEnv = await tauriInvoke<string | null>(TAURI_COMMANDS.VAULT_ROOT_FROM_ENV);
  if (fromEnv?.trim() && (await isUsableRoot(fromEnv))) {
    return cacheVaultRoot(fromEnv);
  }

  const fromAutoDetect = await tauriInvoke<string | null>(TAURI_COMMANDS.VAULT_ROOT_AUTO_DETECT);
  if (fromAutoDetect?.trim()) {
    return cacheVaultRoot(fromAutoDetect);
  }

  const fromDevFallback = await tauriInvoke<string | null>(
    TAURI_COMMANDS.VAULT_ROOT_DEV_FALLBACK,
  );
  if (fromDevFallback?.trim()) {
    return cacheVaultRoot(fromDevFallback);
  }

  throw new Error(VAULT_ROOT_NOT_CONFIGURED);
}

export async function tryResolveVaultRootPath(): Promise<string | null> {
  try {
    return await resolveVaultRootPath();
  } catch {
    return null;
  }
}

export function isVaultRootNotConfiguredError(error: unknown): boolean {
  return error instanceof Error && error.message === VAULT_ROOT_NOT_CONFIGURED;
}

export async function validateVaultRootPath(path: string): Promise<boolean> {
  const trimmed = path.trim();
  if (!trimmed) return false;
  return tauriInvoke<boolean>(TAURI_COMMANDS.VAULT_ROOT_IS_VALID, { path: trimmed });
}

/** Create the standard Upriv layout under `path`; returns the canonical root. */
export async function initializeVaultRootPath(path: string): Promise<string> {
  const trimmed = path.trim();
  const root = await tauriInvoke<string>(TAURI_COMMANDS.VAULT_ROOT_INITIALIZE, { path: trimmed });
  return cacheVaultRoot(root);
}
