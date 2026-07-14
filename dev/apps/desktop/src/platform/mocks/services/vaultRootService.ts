import type {
  NearbyVaultRootStatus,
  VaultRootResolveResult,
  VaultRootService,
} from "@upriv/shared";
import { RpcError, VAULT_ROOT_ALIAS_FILE, VAULT_ROOT_ERROR_CODES } from "@upriv/shared";
import { MOCK_UPRIV_ROOT_PATH } from "@/platform/mocks/data/appSettings";

const STORAGE_KEY = "upriv.mockVaultRoot";
/** Force inspect/nearby/resolve edge cases for browser prototypes. */
const FORCE_STATUS_KEY = "upriv.mockVaultRoot.forceStatus";

/**
 * Browser stand-in for FS + `.upriv-root`.
 * Mirrors Rust resolve: `autoDetect=true` → nearby only (active alias ignored);
 * `autoDetect=false` → active alias path.
 */
interface MockVaultRootState {
  /** When false / missing, launch shows the setup modal. */
  configured: boolean;
  /** Nearby / fixed root currently in use. */
  rootPath: string;
  /** Remembered fixed path (`.upriv-root` path line), kept when inactive. */
  aliasPath?: string;
  /** `true` = fixed mode would use alias; ignored when caller passes `autoDetect=true`. */
  aliasActive: boolean;
}

type MockForceStatus = NearbyVaultRootStatus | "alias_invalid" | "needs_setup" | null;

function readForceStatus(): MockForceStatus {
  try {
    const raw = localStorage.getItem(FORCE_STATUS_KEY);
    if (
      raw === "absent" ||
      raw === "valid" ||
      raw === "incomplete" ||
      raw === "unreadable" ||
      raw === "alias_invalid" ||
      raw === "needs_setup"
    ) {
      return raw;
    }
  } catch {
    // ignore
  }
  return null;
}

function readState(): MockVaultRootState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MockVaultRootState & {
      mode?: "auto" | "fixed";
      rememberedPath?: string;
    };
    // Migrate older mock shape (`mode` / `rememberedPath`).
    if (parsed.aliasActive === undefined) {
      const mode = parsed.mode;
      const remembered = parsed.rememberedPath?.trim();
      return {
        configured: parsed.configured,
        rootPath: parsed.rootPath,
        aliasPath: remembered || (mode === "fixed" ? parsed.rootPath : undefined),
        aliasActive: mode === "fixed",
      };
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeState(state: MockVaultRootState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function mockAliasFilePath(): string {
  return `${MOCK_UPRIV_ROOT_PATH}/bin/${VAULT_ROOT_ALIAS_FILE}`;
}

function mockNearbyAnchor(): string {
  return `${MOCK_UPRIV_ROOT_PATH}/bin`;
}

/** Browser prototype — localStorage stands in for FS + `.upriv-root`. */
export const mockVaultRootService: VaultRootService = {
  async resolve(options = {}) {
    const force = readForceStatus();
    if (force === "alias_invalid") {
      throw new RpcError(VAULT_ROOT_ERROR_CODES.ALIAS_INVALID, "mock: vault root alias invalid");
    }
    if (force === "incomplete") {
      throw new RpcError(VAULT_ROOT_ERROR_CODES.INCOMPLETE, "mock: vault root incomplete");
    }
    if (force === "unreadable") {
      throw new RpcError("io_error", "mock: vault root unreadable");
    }
    if (force === "needs_setup" || force === "absent") {
      return {
        status: "needs_setup",
        aliasPath: mockAliasFilePath(),
        nearbyAnchor: mockNearbyAnchor(),
      };
    }

    const autoDetect = options.autoDetect ?? true;
    const explicit = options.explicitPath?.trim();
    if (explicit) {
      return { status: "found", rootPath: explicit, source: "explicit" };
    }

    const state = readState();
    if (!state?.configured) {
      return {
        status: "needs_setup",
        aliasPath: mockAliasFilePath(),
        nearbyAnchor: mockNearbyAnchor(),
      };
    }

    // Fixed mode only — autoDetect ignores an active alias (settings are source of truth).
    if (!autoDetect) {
      const path = state.aliasPath?.trim() || state.rootPath;
      if (!path) {
        return {
          status: "needs_setup",
          aliasPath: mockAliasFilePath(),
          nearbyAnchor: mockNearbyAnchor(),
        };
      }
      return { status: "found", rootPath: path, source: "alias" };
    }

    return {
      status: "found",
      rootPath: state.rootPath || MOCK_UPRIV_ROOT_PATH,
      source: "nearby",
    };
  },

  async setupNearby(options?: {
    replaceIncomplete?: boolean;
    replacePolicy?: "delete" | "rename";
  }) {
    const force = readForceStatus();
    if (force === "incomplete" && !options?.replaceIncomplete) {
      throw new RpcError(VAULT_ROOT_ERROR_CODES.INCOMPLETE, "mock: nearby incomplete");
    }
    if (force === "unreadable") {
      throw new RpcError("io_error", "mock: nearby unreadable");
    }
    const previous = readState();
    const rootPath = MOCK_UPRIV_ROOT_PATH;
    writeState({
      configured: true,
      rootPath,
      aliasPath: previous?.aliasPath ?? previous?.rootPath,
      aliasActive: false,
    });
    if (options?.replaceIncomplete) {
      localStorage.removeItem(FORCE_STATUS_KEY);
    }
    return { rootPath };
  },

  async setupAtPath(path, options) {
    const force = readForceStatus();
    if (force === "incomplete" && !options?.replaceIncomplete) {
      throw new RpcError(VAULT_ROOT_ERROR_CODES.INCOMPLETE, "mock: path incomplete");
    }
    const rootPath = path.trim() || MOCK_UPRIV_ROOT_PATH;
    writeState({
      configured: true,
      rootPath,
      aliasPath: rootPath,
      aliasActive: true,
    });
    if (options?.replaceIncomplete) {
      localStorage.removeItem(FORCE_STATUS_KEY);
    }
    return { rootPath, aliasPath: mockAliasFilePath() };
  },

  async rewriteAlias(path) {
    const rootPath = path.trim();
    if (!rootPath) return;
    const previous = readState();
    writeState({
      configured: true,
      rootPath: previous?.rootPath || rootPath,
      aliasPath: rootPath,
      aliasActive: true,
    });
  },

  async deactivateAlias() {
    const state = readState();
    if (!state) return;
    writeState({
      ...state,
      aliasPath: state.aliasPath || state.rootPath,
      aliasActive: false,
    });
  },

  async readAlias() {
    const state = readState();
    const path = state?.aliasPath?.trim();
    if (!path) return null;
    return { path, active: state?.aliasActive === true };
  },

  async nearbyStatus() {
    const force = readForceStatus();
    if (
      force === "absent" ||
      force === "valid" ||
      force === "incomplete" ||
      force === "unreadable"
    ) {
      return { status: force, nearbyAnchor: mockNearbyAnchor() };
    }
    const state = readState();
    if (!state?.configured) {
      return { status: "absent" as const, nearbyAnchor: mockNearbyAnchor() };
    }
    return { status: "valid" as const, nearbyAnchor: mockNearbyAnchor() };
  },

  async inspectAtPath(path) {
    const trimmed = path.trim();
    const force = readForceStatus();
    if (
      force === "absent" ||
      force === "valid" ||
      force === "incomplete" ||
      force === "unreadable"
    ) {
      return { status: force, path: trimmed || MOCK_UPRIV_ROOT_PATH };
    }
    return {
      status: trimmed ? ("valid" as const) : ("absent" as const),
      path: trimmed || MOCK_UPRIV_ROOT_PATH,
    };
  },

  async pickFolder(defaultPath) {
    if (typeof window === "undefined") return null;
    const state = readState();
    const suggested =
      defaultPath?.trim() || state?.aliasPath || state?.rootPath || MOCK_UPRIV_ROOT_PATH;
    const picked = window.prompt("Upriv root folder path", suggested);
    const trimmed = picked?.trim();
    return trimmed ? trimmed : null;
  },
};

/** Test helper — force the setup modal on next resolve. */
export function resetMockVaultRootSetup(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(FORCE_STATUS_KEY);
}

/**
 * Force mock vault-root edge cases (browser only).
 * Examples: `incomplete`, `unreadable`, `alias_invalid`, `needs_setup`, `absent`.
 * Pass `null` to clear.
 */
export function setMockVaultRootForceStatus(status: MockForceStatus): void {
  if (status == null) {
    localStorage.removeItem(FORCE_STATUS_KEY);
    return;
  }
  localStorage.setItem(FORCE_STATUS_KEY, status);
}

export type { VaultRootResolveResult };
