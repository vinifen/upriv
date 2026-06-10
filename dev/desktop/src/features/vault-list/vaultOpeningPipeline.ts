import { mockOpenRamFails, MockPipelineError } from "./mockVaultPipelineErrors";
import { runMockPipeline } from "./vaultPipeline";

export const OPENING_PIPELINE_STEPS = [
  "open.overlay.step_test",
  "open.overlay.step_decrypt",
  "open.overlay.step_mount",
  "open.overlay.step_verify",
] as const;

export type OpeningPipelineStepKey = (typeof OPENING_PIPELINE_STEPS)[number];

/** Mock unlock pipeline — mirrors 7zz test + decrypt + mount + verify. */
export async function runMockOpeningPipeline(
  vaultId: string,
  onStep: (stepIndex: number) => void,
): Promise<void> {
  await runMockPipeline(OPENING_PIPELINE_STEPS.length, onStep, (stepIndex) => {
    if (stepIndex === 2 && mockOpenRamFails(vaultId)) {
      throw new MockPipelineError("error.insufficient_ram");
    }
  });
}
