import type { I18nKey } from "@/i18n/types";
import { getVaultPasswordInRam } from "./mockVaultSessionPassword";

export class MockPipelineError extends Error {
  readonly i18nKey: I18nKey;

  constructor(i18nKey: I18nKey) {
    super(i18nKey);
    this.name = "MockPipelineError";
    this.i18nKey = i18nKey;
  }
}

/** Demo vault that always fails open with insufficient RAM (RF-04c). */
export function mockOpenRamFails(vaultId: string): boolean {
  return vaultId === "cold-storage";
}

/** Demo: unlock with password `gatefail` → close aborts at 7z t gate (RF-05). */
export function mockCloseGateFails(vaultId: string): boolean {
  return getVaultPasswordInRam(vaultId) === "gatefail";
}

export function isMockPipelineError(error: unknown): error is MockPipelineError {
  return error instanceof MockPipelineError;
}
