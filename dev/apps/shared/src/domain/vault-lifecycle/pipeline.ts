import { delayMs } from "../timing/delay";

export const LIFECYCLE_PIPELINE_STEP_MS = 650;

export const OPENING_PIPELINE_STEP_COUNT = 4;
export const CLOSING_PIPELINE_STEP_COUNT = 4;

/** Live open only reports Argon2 + RPC (mock still uses the 4 timed labels). */
export const LIVE_OPENING_PIPELINE_STEP_COUNT = 2;
/** Live close shares the mock labels: flush, then backup (core phase), then done. */
export const LIVE_CLOSING_PIPELINE_STEP_COUNT = CLOSING_PIPELINE_STEP_COUNT;

export async function runTimedPipeline(
  stepCount: number,
  onStep: (stepIndex: number) => void,
  afterStep?: (stepIndex: number) => void,
): Promise<void> {
  for (let index = 0; index < stepCount; index += 1) {
    onStep(index);
    await delayMs(LIFECYCLE_PIPELINE_STEP_MS);
    afterStep?.(index);
  }
}
