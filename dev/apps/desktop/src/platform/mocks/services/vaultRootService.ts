/**
 * Browser stand-in for vault-root FS + `.upriv-root` (in-memory only).
 *
 * Temporary: all `platform/mocks` will be removed once Electron/daemon wiring
 * covers the same flows — keep this file minimal.
 *
 * Policy: never use `localStorage` (or other browser storage) for vault-root or
 * product state — not in mocks, not in Electron. Real persistence is disk via
 * `upriv-daemon` / `upriv-core` only.
 *
 * Resolve contract (align with core): Gate must pass `explicitPath: null` and
 * rely on `vaultRootMode` + alias. `explicitPath` here is only for rare
 * env-style / devtools overrides — do not treat settings wire path as explicit.
 */
import type { VaultRootMode, VaultRootService } from "@upriv/shared";
import { VAULT_ROOT_ALIAS_FILE } from "@upriv/shared";
import { MOCK_UPRIV_ROOT_PATH } from "@/platform/mocks/data/appSettings";

interface MockVaultRootState {
  configured: boolean;
  rootPath: string;
  aliasPath?: string;
  aliasActive: boolean;
}

let runtimeState: MockVaultRootState | null = null;

function mockAliasFilePath(): string {
  return `${MOCK_UPRIV_ROOT_PATH}/bin/${VAULT_ROOT_ALIAS_FILE}`;
}

function mockDefaultRootAnchor(): string {
  return `${MOCK_UPRIV_ROOT_PATH}/bin`;
}

export const mockVaultRootService: VaultRootService = {
  async resolve(options = {}) {
    const vaultRootMode: VaultRootMode = options.vaultRootMode ?? "default_root";
    // Devtools / rare override only — Gate must not send the settings path here.
    const explicit = options.explicitPath?.trim();
    if (explicit) {
      return { status: "found", rootPath: explicit, source: "explicit" };
    }

    if (!runtimeState?.configured) {
      return {
        status: "needs_setup",
        aliasPath: mockAliasFilePath(),
        defaultRootAnchor: mockDefaultRootAnchor(),
        distribution: "portable",
      };
    }

    if (vaultRootMode === "custom_root") {
      const path = runtimeState.aliasPath?.trim() || runtimeState.rootPath;
      if (!path || !runtimeState.aliasActive) {
        return {
          status: "needs_setup",
          aliasPath: mockAliasFilePath(),
          defaultRootAnchor: mockDefaultRootAnchor(),
          distribution: "portable",
        };
      }
      return { status: "found", rootPath: path, source: "custom_root" };
    }

    return {
      status: "found",
      rootPath: runtimeState.rootPath || MOCK_UPRIV_ROOT_PATH,
      source: "default_root",
    };
  },

  async setupDefaultRoot() {
    const previous = runtimeState;
    const rootPath = MOCK_UPRIV_ROOT_PATH;
    runtimeState = {
      configured: true,
      rootPath,
      aliasPath: previous?.aliasPath ?? previous?.rootPath,
      aliasActive: false,
    };
    return { rootPath };
  },

  async setupAtPath(path) {
    const rootPath = path.trim() || MOCK_UPRIV_ROOT_PATH;
    runtimeState = {
      configured: true,
      rootPath,
      aliasPath: rootPath,
      aliasActive: true,
    };
    return { rootPath, aliasPath: mockAliasFilePath() };
  },

  async readAlias() {
    const path = runtimeState?.aliasPath?.trim();
    if (!path) return null;
    return { path, active: runtimeState?.aliasActive === true };
  },

  async defaultRootStatus() {
    if (!runtimeState?.configured) {
      return { status: "absent" as const, defaultRootAnchor: mockDefaultRootAnchor() };
    }
    return { status: "valid" as const, defaultRootAnchor: mockDefaultRootAnchor() };
  },

  async inspectAtPath(path) {
    const trimmed = path.trim();
    return {
      status: trimmed ? ("valid" as const) : ("absent" as const),
      path: trimmed || MOCK_UPRIV_ROOT_PATH,
    };
  },

  async suggestedCustomRootPath() {
    return MOCK_UPRIV_ROOT_PATH;
  },

  async pickFolder(defaultPath) {
    if (typeof window === "undefined") return null;
    const suggested =
      defaultPath?.trim() ||
      runtimeState?.aliasPath ||
      runtimeState?.rootPath ||
      MOCK_UPRIV_ROOT_PATH;
    const picked = window.prompt("Upriv root folder path", suggested);
    const trimmed = picked?.trim();
    return trimmed ? trimmed : null;
  },
};
