/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createDefaultAppSettings,
  createEmptyCreateVaultDraft,
  ROW_ROLE_GUARD_MS,
} from "@upriv/shared";
import { CreateVaultModal } from "../CreateVaultModal";

const settings = createDefaultAppSettings();
const createVaultService = {};
const jobService = {};
const vaultRootService = { resolve: async () => ({ status: "found", rootPath: "/data" }) };

vi.mock("@/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("@/features/system/settings", () => ({
  useAppSettingsContext: () => ({
    settings,
    showHiddenVaultsSession: false,
    reportVaultRootIntegrityFailure: () => undefined,
  }),
}));
vi.mock("@/platform/services", () => ({
  useCreateVaultService: () => createVaultService,
  useJobService: () => jobService,
  useVaultRootService: () => vaultRootService,
}));
vi.mock("../createVaultSteps", () => ({
  renderCreateVaultStep: () => null,
  invalidateImportPicks: () => undefined,
}));

const NOTICE = "password_weakness.common";
const CREATE = "vault.create.action.create";

async function openWizard(password: string) {
  const onCreate = vi.fn();
  render(
    createElement(CreateVaultModal, {
      open: true,
      existingVaultIds: [],
      existingOrders: [],
      initialDraft: {
        ...createEmptyCreateVaultDraft([]),
        source: "scratch",
        displayName: "Lighthouse Ledger",
        password,
        passwordConfirm: password,
      },
      initialStep: "advanced",
      onClose: () => undefined,
      onCreate,
    }),
  );
  await act(async () => {});
  return onCreate;
}

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CreateVaultModal footer", () => {
  it("shows a weak password's notice on the first press and creates on the next", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const onCreate = await openWizard("password1");
    expect(screen.queryByText(NOTICE)).toBeNull();

    fireEvent.click(screen.getByText(CREATE));
    expect(screen.getByText(NOTICE)).toBeTruthy();
    expect(onCreate).not.toHaveBeenCalled();

    now.mockReturnValue(10_000 + ROW_ROLE_GUARD_MS);
    fireEvent.click(screen.getByText(CREATE));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("takes the notice down on Back", async () => {
    const onCreate = await openWizard("password1");
    fireEvent.click(screen.getByText(CREATE));
    fireEvent.click(screen.getByText("vault.create.action.back"));
    expect(screen.queryByText(NOTICE)).toBeNull();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("takes the notice down on a press anywhere in the step", async () => {
    await openWizard("password1");
    fireEvent.click(screen.getByText(CREATE));
    const stepBody = document.querySelector(".overflow-y-auto");
    if (!stepBody) throw new Error("expected the step's body");
    fireEvent.pointerDown(stepBody);
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it("creates on the first press when nothing is wrong", async () => {
    const onCreate = await openWizard("the quiet river behind us");
    fireEvent.click(screen.getByText(CREATE));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });
});
