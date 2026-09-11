import { describe, expect, it } from "vitest";
import {
  createEmptyCreateVaultDraft,
  createVaultWizardInitialState,
  createVaultWizardReducer,
  resolveCreateVaultCloseIntent,
  selectCreateVaultWizardView,
  type CreateVaultWizardAction,
  type CreateVaultWizardContext,
  type CreateVaultWizardState,
} from "..";
import { createVaultDraftFixture } from "./fixtures";

const EMPTY_CONTEXT: CreateVaultWizardContext = { existingVaultIds: [], knownGroupIds: [] };

function reduce(
  state: CreateVaultWizardState,
  ...actions: CreateVaultWizardAction[]
): CreateVaultWizardState {
  return actions.reduce(createVaultWizardReducer, state);
}

function openedAt(step: CreateVaultWizardState["currentStep"], draft = createVaultDraftFixture()) {
  return reduce(createVaultWizardInitialState([]), { type: "opened", draft, step });
}

describe("createVaultWizardInitialState", () => {
  it("starts on source with nothing attempted", () => {
    const state = createVaultWizardInitialState([]);
    expect(state.currentStep).toBe("source");
    expect(state.attemptedSteps.size).toBe(0);
    expect(state.submitAttempted).toBe(false);
    expect(state.draft).toEqual(state.baseline);
  });

  it("orders the draft after existing vaults", () => {
    expect(createVaultWizardInitialState([1, 4]).draft.order).toBe(5);
  });
});

describe("createVaultWizardReducer / navigation", () => {
  it("advances only when the current step is valid", () => {
    const invalid = openedAt("identity", createVaultDraftFixture([], { displayName: "" }));
    const blocked = reduce(invalid, { type: "nextRequested", context: EMPTY_CONTEXT });
    expect(blocked.currentStep).toBe("identity");
    expect(blocked.attemptedSteps.has("identity")).toBe(true);

    const valid = openedAt("identity");
    expect(reduce(valid, { type: "nextRequested", context: EMPTY_CONTEXT }).currentStep).toBe(
      "password",
    );
  });

  it("marks the step attempted even when it blocks", () => {
    const state = openedAt("identity", createVaultDraftFixture([], { displayName: "" }));
    const next = reduce(state, { type: "nextRequested", context: EMPTY_CONTEXT });
    expect([...next.attemptedSteps]).toEqual(["identity"]);
  });

  it("stays put at the wizard edges", () => {
    expect(reduce(openedAt("source"), { type: "backRequested" }).currentStep).toBe("source");
    const last = openedAt("advanced");
    expect(reduce(last, { type: "nextRequested", context: EMPTY_CONTEXT }).currentStep).toBe(
      "advanced",
    );
  });

  it("goes back without validating", () => {
    const state = openedAt("password", createVaultDraftFixture([], { password: "" }));
    expect(reduce(state, { type: "backRequested" }).currentStep).toBe("identity");
  });
});

describe("createVaultWizardReducer / draft edits", () => {
  it("merges patches and dismisses the discard confirm", () => {
    const state = reduce(openedAt("identity"), { type: "discardConfirmRequested" });
    const patched = reduce(state, { type: "draftPatched", patch: { displayName: "Renamed" } });
    expect(patched.draft.displayName).toBe("Renamed");
    expect(patched.draft.password).toBe(state.draft.password);
    expect(patched.discardConfirmOpen).toBe(false);
  });

  it("restores the baseline on discard", () => {
    const state = openedAt("identity");
    const edited = reduce(state, { type: "draftPatched", patch: { displayName: "Changed" } });
    expect(reduce(edited, { type: "draftDiscarded" }).draft).toEqual(state.baseline);
  });
});

describe("createVaultWizardReducer / import password test", () => {
  it("records a passing check", () => {
    const state = reduce(openedAt("password"), { type: "importPasswordTestStarted" });
    expect(state.testingPassword).toBe(true);

    const done = reduce(state, { type: "importPasswordTestFinished", ok: true });
    expect(done.testingPassword).toBe(false);
    expect(done.draft.passwordValidated).toBe(true);
    expect(done.draft.passwordTestFailed).toBe(false);
  });

  it("records a failing check", () => {
    const done = reduce(
      openedAt("password"),
      { type: "importPasswordTestStarted" },
      { type: "importPasswordTestFinished", ok: false },
    );
    expect(done.draft.passwordValidated).toBe(false);
    expect(done.draft.passwordTestFailed).toBe(true);
  });

  it("keeps the discard confirmation open when a probe answers", () => {
    const done = reduce(
      openedAt("password"),
      { type: "importPasswordTestStarted" },
      { type: "discardConfirmRequested" },
      { type: "importPasswordTestFinished", ok: true },
    );
    expect(done.discardConfirmOpen).toBe(true);
  });
});

describe("createVaultWizardReducer / submit and close", () => {
  it("marks every step attempted on submit", () => {
    const state = reduce(openedAt("advanced"), { type: "submitRequested" });
    expect(state.submitAttempted).toBe(true);
    expect(state.attemptedSteps.size).toBe(5);
  });

  it("clears submit state on close so reopening is quiet", () => {
    const state = reduce(openedAt("advanced"), { type: "submitRequested" }, { type: "closed" });
    expect(state.submitAttempted).toBe(false);
  });

  it("resets everything when reopened", () => {
    const dirty = reduce(
      openedAt("identity"),
      { type: "draftPatched", patch: { displayName: "Changed" } },
      { type: "submitRequested" },
      { type: "discardConfirmRequested" },
    );
    const draft = createEmptyCreateVaultDraft([]);
    const reopened = reduce(dirty, { type: "opened", draft, step: "source" });
    expect(reopened).toEqual({
      baseline: draft,
      draft,
      currentStep: "source",
      attemptedSteps: new Set(),
      submitAttempted: false,
      testingPassword: false,
      discardConfirmOpen: false,
    });
  });
});

describe("resolveCreateVaultCloseIntent", () => {
  it("closes straight away when the draft is untouched", () => {
    expect(resolveCreateVaultCloseIntent(openedAt("identity"))).toBe("close");
  });

  it("asks for confirmation once the draft differs from the baseline", () => {
    const edited = reduce(openedAt("identity"), {
      type: "draftPatched",
      patch: { displayName: "Changed" },
    });
    expect(resolveCreateVaultCloseIntent(edited)).toBe("ask-confirm");
  });

  it("dismisses the open confirm instead of closing", () => {
    const asking = reduce(openedAt("identity"), { type: "discardConfirmRequested" });
    expect(resolveCreateVaultCloseIntent(asking)).toBe("dismiss-confirm");
  });
});

describe("selectCreateVaultWizardView", () => {
  it("hides inline errors until the step is attempted", () => {
    const state = openedAt("identity", createVaultDraftFixture([], { displayName: "" }));
    expect(selectCreateVaultWizardView(state, EMPTY_CONTEXT).inlineErrors).toEqual([]);

    const attempted = reduce(state, { type: "nextRequested", context: EMPTY_CONTEXT });
    expect(selectCreateVaultWizardView(attempted, EMPTY_CONTEXT).inlineErrors).toContain("empty");
  });

  it("reports the wizard edges", () => {
    expect(selectCreateVaultWizardView(openedAt("source"), EMPTY_CONTEXT).isFirstStep).toBe(true);
    expect(selectCreateVaultWizardView(openedAt("advanced"), EMPTY_CONTEXT).isLastStep).toBe(true);
  });

  it("tracks dirtiness against the baseline", () => {
    const state = openedAt("identity");
    expect(selectCreateVaultWizardView(state, EMPTY_CONTEXT).isDirty).toBe(false);

    const edited = reduce(state, { type: "draftPatched", patch: { note: "hello" } });
    expect(selectCreateVaultWizardView(edited, EMPTY_CONTEXT).isDirty).toBe(true);
  });

  it("blocks create while a step is invalid and allows it once complete", () => {
    const invalid = openedAt("advanced", createVaultDraftFixture([], { displayName: "" }));
    expect(selectCreateVaultWizardView(invalid, EMPTY_CONTEXT).canCreate).toBe(false);
    expect(selectCreateVaultWizardView(openedAt("advanced"), EMPTY_CONTEXT).canCreate).toBe(true);
  });

  it("shows a step as incomplete before attempt and error after", () => {
    const state = openedAt("identity", createVaultDraftFixture([], { displayName: "" }));
    expect(selectCreateVaultWizardView(state, EMPTY_CONTEXT).stepStatuses.identity).toBe(
      "incomplete",
    );

    const attempted = reduce(state, { type: "nextRequested", context: EMPTY_CONTEXT });
    expect(selectCreateVaultWizardView(attempted, EMPTY_CONTEXT).stepStatuses.identity).toBe(
      "error",
    );
  });
});
