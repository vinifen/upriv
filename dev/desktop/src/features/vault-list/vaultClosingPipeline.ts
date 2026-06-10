import { mockCloseGateFails, MockPipelineError } from "./mockVaultPipelineErrors";
import { runMockPipeline } from "./vaultPipeline";

export const CLOSING_PIPELINE_STEPS = [
  "close.overlay.step_test",
  "close.overlay.step_backup",
  "close.overlay.step_compress",
  "close.overlay.step_verify",
] as const;

export type ClosingPipelineStepKey = (typeof CLOSING_PIPELINE_STEPS)[number];

/** Mock close/seal pipeline — mirrors 7zz gate + backup + compress + test. */
export async function runMockClosingPipeline(
  vaultId: string,
  onStep: (stepIndex: number) => void,
): Promise<void> {
  await runMockPipeline(CLOSING_PIPELINE_STEPS.length, onStep, (stepIndex) => {
    if (stepIndex === 0 && mockCloseGateFails(vaultId)) {
      throw new MockPipelineError("error.archive_test_failed");
    }
  });
}
