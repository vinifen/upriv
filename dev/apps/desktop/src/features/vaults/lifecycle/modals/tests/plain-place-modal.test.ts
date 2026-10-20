/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createDefaultAppSettings } from "@upriv/shared";
import { PlainPlaceModal } from "../PlainFolderModals";

vi.mock("@/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("@/features/system/settings", () => ({
  useAppSettingsContext: () => ({ settings: createDefaultAppSettings() }),
}));
const pickFolder = vi.fn<(initial: string | null, title: string) => Promise<string | null>>();

vi.mock("@/platform/services", () => ({
  useVaultRootService: () => ({
    resolve: async () => ({ status: "found", rootPath: "/data", source: "default_root" }),
    pickFolder,
  }),
}));

function show(workspaceChoices: boolean, onContinue = vi.fn()) {
  render(
    createElement(PlainPlaceModal, {
      open: true,
      vaultName: "Notes",
      workspaceChoices,
      submitting: false,
      warningClass: null,
      onClose: () => {},
      onContinue,
      onAcceptWarning: () => {},
    }),
  );
  return onContinue;
}

function radio(value: string): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`);
  if (!input) throw new Error(`no ${value} radio`);
  return input;
}

/** The option's card wears the attention border: chosen and a step is left. */
function needsStep(value: string): boolean {
  return radio(value).closest("label")?.className.includes("vault-status-recovery") ?? false;
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
  pickFolder.mockReset();
});

describe("PlainPlaceModal", () => {
  it("opens with Default workspace chosen, ready to continue", async () => {
    const onContinue = show(true);
    expect(radio("default").checked).toBe(true);

    const continueButton = screen.getByRole("button", { name: "action.continue" });
    await waitFor(() => expect(continueButton).toHaveProperty("disabled", false));
    fireEvent.click(continueButton);
    expect(onContinue).toHaveBeenCalledWith("default", "");
  });

  it("opens on This vault only while the shared workspace is locked", () => {
    show(false);
    expect(radio("vault_only").checked).toBe(true);
    expect(radio("default").checked).toBe(false);
    expect(needsStep("vault_only")).toBe(true);
  });

  it("opens nothing when a folder option is chosen, and holds Continue until it has a folder", async () => {
    const onContinue = show(true);
    const continueButton = screen.getByRole("button", { name: "action.continue" });
    await waitFor(() => expect(continueButton).toHaveProperty("disabled", false));

    fireEvent.click(radio("custom"));
    expect(pickFolder).not.toHaveBeenCalled();
    expect(needsStep("custom")).toBe(true);
    expect(continueButton).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByPlaceholderText("modal.folder_field.placeholder"), {
      target: { value: " /media/files " },
    });
    expect(needsStep("custom")).toBe(false);
    fireEvent.click(continueButton);
    expect(onContinue).toHaveBeenCalledWith("custom", "/media/files");
  });

  it("still opens the folder picker from its button", async () => {
    pickFolder.mockResolvedValueOnce("/media/picked");
    show(true);
    fireEvent.click(radio("vault_only"));
    fireEvent.click(
      screen.getByRole("button", { name: "modal.app_settings.action.pick_workspace_folder" }),
    );
    await waitFor(() =>
      expect(screen.getByPlaceholderText("modal.folder_field.placeholder")).toHaveProperty(
        "value",
        "/media/picked",
      ),
    );
    expect(needsStep("vault_only")).toBe(false);
  });
});
