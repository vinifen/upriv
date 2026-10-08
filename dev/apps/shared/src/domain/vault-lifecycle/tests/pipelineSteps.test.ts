import { describe, expect, it } from "vitest";
import {
  CLOSING_PIPELINE_STEP_COUNT,
  LIVE_CLOSING_PIPELINE_STEP_COUNT,
  LIVE_OPENING_PIPELINE_STEP_COUNT,
  OPENING_PIPELINE_STEP_COUNT,
} from "../pipeline";
import {
  CLOSING_BACKUP_STEP,
  CLOSING_DONE_STEP,
  CLOSING_PIPELINE_STEP_KEYS,
  OPENING_PIPELINE_STEP_KEYS,
  lifecycleBusyLabelKey,
} from "../pipelineSteps";

describe("live pipeline step counts", () => {
  it("matches the live onStep calls", () => {
    expect(LIVE_OPENING_PIPELINE_STEP_COUNT).toBe(2);
    expect(LIVE_CLOSING_PIPELINE_STEP_COUNT).toBe(4);
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
    expect(lifecycleBusyLabelKey("close", CLOSING_BACKUP_STEP)).toBe("close.step.backup");
    expect(lifecycleBusyLabelKey("close", CLOSING_DONE_STEP)).toBe("close.step.done");
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
