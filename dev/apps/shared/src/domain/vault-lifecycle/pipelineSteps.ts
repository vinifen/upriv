import type { I18nKey } from "../../i18n/catalog";

/** i18n keys for opening overlay steps (UI only). */
export const OPENING_PIPELINE_STEPS = [
  "overlay.step_test_header",
  "open.overlay.step_decrypt",
  "open.overlay.step_mount",
  "open.overlay.step_verify",
] as const satisfies readonly I18nKey[];

export type OpeningPipelineStepKey = (typeof OPENING_PIPELINE_STEPS)[number];

/** i18n keys for close overlay steps (UI only). */
export const CLOSING_PIPELINE_STEPS = [
  "overlay.step_test_header",
  "close.overlay.step_backup",
  "close.overlay.step_flush",
  "close.overlay.step_verify",
] as const satisfies readonly I18nKey[];

export type ClosingPipelineStepKey = (typeof CLOSING_PIPELINE_STEPS)[number];
