export const PIPELINE_STEP_MS = 650;

export async function runMockPipeline(
  stepCount: number,
  onStep: (stepIndex: number) => void,
  afterStep?: (stepIndex: number) => void,
): Promise<void> {
  for (let index = 0; index < stepCount; index += 1) {
    onStep(index);
    await new Promise((resolve) => setTimeout(resolve, PIPELINE_STEP_MS));
    afterStep?.(index);
  }
}
