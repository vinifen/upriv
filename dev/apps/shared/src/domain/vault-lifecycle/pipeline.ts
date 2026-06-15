export const LIFECYCLE_PIPELINE_STEP_MS = 650;

export const OPENING_PIPELINE_STEP_COUNT = 4;
export const CLOSING_PIPELINE_STEP_COUNT = 4;

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const schedule = (globalThis as { setTimeout?: (fn: () => void, delay: number) => void })
      .setTimeout;
    if (schedule) schedule(resolve, ms);
    else resolve();
  });
}

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
