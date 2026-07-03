import { createDefaultAppSettings, normalizeAppSettings, type AppSettingsService } from "@upriv/shared";
import { TAURI_COMMANDS, tauriInvoke } from "@/lib/tauri";
import { mapRawAppSettings, unmapAppSettings, type RawAppSettings } from "./mapAppSettings";
import { getVaultRootPath, resolveVaultRootPath, setVaultRootPath } from "./vaultRoot";

async function loadLocalVaultRootPath(): Promise<string | null> {
  const path = await tauriInvoke<string | null>(TAURI_COMMANDS.APP_VAULT_ROOT_PATH_GET);
  const trimmed = path?.trim();
  return trimmed ? trimmed : null;
}

export function createTauriAppSettingsService(): AppSettingsService {
  return {
    async load() {
      const localRoot = await loadLocalVaultRootPath();
      if (localRoot) {
        setVaultRootPath(localRoot);
      }

      let vaultRoot: string;
      try {
        vaultRoot = await resolveVaultRootPath();
      } catch {
        // No usable vault root yet → defaults; the list screen prompts setup.
        setVaultRootPath(null);
        return createDefaultAppSettings();
      }

      try {
        const raw = await tauriInvoke<RawAppSettings>(TAURI_COMMANDS.APP_SETTINGS_GET, {
          vaultRoot,
        });
        return normalizeAppSettings(mapRawAppSettings(raw, localRoot ?? ""));
      } catch {
        // Resolved root is no longer a valid Upriv root (e.g. drive unplugged,
        // structure missing). Forget it and fall back to defaults so the app
        // still loads and can prompt the user to choose a folder.
        setVaultRootPath(null);
        return createDefaultAppSettings();
      }
    },

    async save(config) {
      const normalized = normalizeAppSettings(config);

      if (normalized.app.auto_detect_vault_root) {
        await tauriInvoke(TAURI_COMMANDS.APP_VAULT_ROOT_PATH_SET, { path: null });
      } else {
        const manualRoot = normalized.app.upriv_root_path.trim();
        await tauriInvoke(TAURI_COMMANDS.APP_VAULT_ROOT_PATH_SET, {
          path: manualRoot || null,
        });
        setVaultRootPath(manualRoot || null);
      }

      const vaultRoot = await resolveVaultRootPath();
      await tauriInvoke(TAURI_COMMANDS.APP_SETTINGS_SAVE, {
        vaultRoot,
        settings: unmapAppSettings(normalized),
      });
    },

    getDefaultRootPathSuggestion() {
      return getVaultRootPath() ?? "";
    },

    async pickVaultRootFolder() {
      return tauriInvoke<string | null>(TAURI_COMMANDS.PICK_VAULT_ROOT_FOLDER);
    },
  };
}
