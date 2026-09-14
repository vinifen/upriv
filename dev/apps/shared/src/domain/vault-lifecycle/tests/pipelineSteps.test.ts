import { describe, expect, it } from "vitest";
import {
  CLOSING_PIPELINE_STEP_COUNT,
  LIVE_CLOSING_PIPELINE_STEP_COUNT,
  LIVE_OPENING_PIPELINE_STEP_COUNT,
  OPENING_PIPELINE_STEP_COUNT,
} from "../pipeline";
import {
  CLOSING_PIPELINE_STEP_KEYS,
  OPENING_PIPELINE_STEP_KEYS,
  lifecycleBusyLabelKey,
} from "../pipelineSteps";

describe("live pipeline step counts", () => {
  it("matches the two live onStep calls, not the mock four-step labels", () => {
    expect(LIVE_OPENING_PIPELINE_STEP_COUNT).toBe(2);
    expect(LIVE_CLOSING_PIPELINE_STEP_COUNT).toBe(2);
    expect(OPENING_PIPELINE_STEP_COUNT).toBe(4);
    expect(CLOSING_PIPELINE_STEP_COUNT).toBe(4);
  });
});

describe("lifecycleBusyLabelKey", () => {
  it("uses the first unlock step while the password unwrap is running", () => {
    expect(lifecycleBusyLabelKey("unlock", 0)).toBe("unlock.step.unlock_keys");
  });

  it("advances through later unlock and close steps", () => {
    expect(lifecycleBusyLabelKey("unlock", 1)).toBe("unlock.step.open_session");
    expect(lifecycleBusyLabelKey("close", 0)).toBe("close.step.flush");
    expect(lifecycleBusyLabelKey("close", 2)).toBe("close.step.lock");
  });

  it("clamps out-of-range indexes", () => {
    expect(lifecycleBusyLabelKey("unlock", -1)).toBe(OPENING_PIPELINE_STEP_KEYS[0]);
    expect(lifecycleBusyLabelKey("unlock", 99)).toBe(
      OPENING_PIPELINE_STEP_KEYS[OPENING_PIPELINE_STEP_KEYS.length - 1],
    );
    expect(lifecycleBusyLabelKey("close", 99)).toBe(
      CLOSING_PIPELINE_STEP_KEYS[CLOSING_PIPELINE_STEP_KEYS.length - 1],
    );
  });
});
