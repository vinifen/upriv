/** i18n keys for opening overlay steps (UI only). */
export const OPENING_PIPELINE_STEPS = [
  "open.overlay.step_test",
  "open.overlay.step_decrypt",
  "open.overlay.step_mount",
  "open.overlay.step_verify",
] as const;

export type OpeningPipelineStepKey = (typeof OPENING_PIPELINE_STEPS)[number];

/** i18n keys for close/seal overlay steps (UI only). */
export const CLOSING_PIPELINE_STEPS = [
  "close.overlay.step_test",
  "close.overlay.step_backup",
  "close.overlay.step_compress",
  "close.overlay.step_verify",
] as const;

export type ClosingPipelineStepKey = (typeof CLOSING_PIPELINE_STEPS)[number];
