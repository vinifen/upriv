/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  AppUnlockedChoice,
  DeviceGroups,
  FolderState,
  FolderStatus,
  VaultUnlockedChoice,
} from "@upriv/shared";
import { PlainPlaceModal } from "../PlainFolderModals";

vi.mock("@/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key, locale: "en" }) }));
const pickFolder = vi.fn<(initial: string | null, title: string) => Promise<string | null>>();

const HERE = "a".repeat(32);
const deviceService = {
  info: async () => ({ id: HERE, system: "linux" as const }),
};

/** What each folder's disk check answers: every folder is there unless a test says otherwise. */
let folderStates: Record<string, FolderState> = {};
const status = vi.fn(async (_list: string, path: string): Promise<FolderStatus> => ({
  state: folderStates[path] ?? "ok",
  details: null,
}));

/** The app's list already holds `/mnt/ssd`, the vault's own `/media/usb`. */
const APP: DeviceGroups<AppUnlockedChoice> = {
  [HERE]: {
    system: "linux",
    selected: "none",
    next_number: 2,
    rows: [{ number: 1, name: "", path: "/mnt/ssd" }],
  },
};
const VAULT: DeviceGroups<VaultUnlockedChoice> = {
  [HERE]: {
    system: "linux",
    selected: "inherit",
    next_number: 2,
    rows: [{ number: 1, name: "", path: "/media/usb" }],
  },
};

vi.mock("@/platform/services", () => ({
  useVaultRootService: () => ({
    resolve: async () => ({ status: "found", rootPath: "/data", source: "default" }),
    pickFolder,
  }),
  useDeviceService: () => deviceService,
  useFolderListService: () => ({ status }),
}));

function show(appChoices: boolean, onContinue = vi.fn()) {
  render(
    createElement(PlainPlaceModal, {
      open: true,
      vaultName: "Notes",
      appChoices,
      appUnlocked: APP,
      vaultUnlocked: VAULT,
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

/** The folder field inside an option's card. */
function folderField(value: string): HTMLInputElement {
  const field = radio(value)
    .closest("label")
    ?.querySelector<HTMLInputElement>('input[type="text"]');
  if (!field) throw new Error(`no folder field in ${value}`);
  return field;
}

function pickButton(value: string): HTMLButtonElement {
  const button = radio(value).closest("label")?.querySelector("button");
  if (!button) throw new Error(`no pick button in ${value}`);
  return button;
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
  status.mockClear();
  folderStates = {};
});

describe("PlainPlaceModal", () => {
  it("opens with Beside the data folder chosen, ready to continue", async () => {
    const onContinue = show(true);
    expect(radio("beside").checked).toBe(true);

    const continueButton = screen.getByRole("button", { name: "action.continue" });
    await waitFor(() => expect(continueButton).toHaveProperty("disabled", false));
    expect(screen.getByDisplayValue("/data/upriv-unlocked")).toBeTruthy();
    fireEvent.click(continueButton);
    expect(onContinue).toHaveBeenCalledWith("beside", "");
  });

  it("opens on a folder for this vault only while the app's folders are locked", () => {
    show(false);
    expect(radio("vault_folder").checked).toBe(true);
    expect(radio("beside").checked).toBe(false);
    expect(needsStep("vault_folder")).toBe(true);
  });

  it("opens nothing when a folder option is chosen, and holds Continue until it has a folder", async () => {
    const onContinue = show(true);
    const continueButton = screen.getByRole("button", { name: "action.continue" });
    await waitFor(() => expect(continueButton).toHaveProperty("disabled", false));

    fireEvent.click(radio("app_folder"));
    expect(pickFolder).not.toHaveBeenCalled();
    expect(needsStep("app_folder")).toBe(true);
    expect(continueButton).toHaveProperty("disabled", true);

    fireEvent.change(folderField("app_folder"), { target: { value: " /media/files " } });
    expect(needsStep("app_folder")).toBe(false);
    // The folder's disk check runs once the path settles; Continue waits for it.
    expect(continueButton).toHaveProperty("disabled", true);
    await waitFor(() => expect(continueButton).toHaveProperty("disabled", false));
    expect(status).toHaveBeenCalledWith("unlocked", "/media/files", null);
    fireEvent.click(continueButton);
    expect(onContinue).toHaveBeenCalledWith("app_folder", "/media/files");
  });

  it("says at once why a typed folder cannot be that list's row, and holds Continue", async () => {
    show(true);
    const continueButton = screen.getByRole("button", { name: "action.continue" });
    fireEvent.click(radio("app_folder"));

    fireEvent.change(folderField("app_folder"), { target: { value: "relative" } });
    await waitFor(() => expect(screen.getByText("folder_list.problem.not_absolute")).toBeTruthy());
    expect(needsStep("app_folder")).toBe(true);
    expect(continueButton).toHaveProperty("disabled", true);

    // A folder already in the app's list, and the data folder Beside the data folder is in.
    for (const path of ["/mnt/ssd", "/data"]) {
      fireEvent.change(folderField("app_folder"), { target: { value: path } });
      expect(screen.getByText("folder_list.problem.duplicate")).toBeTruthy();
      expect(continueButton).toHaveProperty("disabled", true);
    }
    expect(status).not.toHaveBeenCalled();

    // The vault's own list is checked against its own rows only.
    fireEvent.click(radio("vault_folder"));
    fireEvent.change(folderField("vault_folder"), { target: { value: "/media/usb" } });
    expect(needsStep("vault_folder")).toBe(true);
    fireEvent.change(folderField("vault_folder"), { target: { value: "/mnt/ssd" } });
    await waitFor(() => expect(continueButton).toHaveProperty("disabled", false));
  });

  it("holds Continue on a folder that is not there, with its status under the field", async () => {
    folderStates = { "/media/gone": "missing" };
    show(true);
    const continueButton = screen.getByRole("button", { name: "action.continue" });
    fireEvent.click(radio("vault_folder"));
    fireEvent.change(folderField("vault_folder"), { target: { value: "/media/gone" } });

    await waitFor(() => expect(screen.getByText("folder_list.status.missing")).toBeTruthy());
    expect(needsStep("vault_folder")).toBe(true);
    expect(continueButton).toHaveProperty("disabled", true);
  });

  it("shows every option's folder, inactive until that option is chosen", () => {
    show(true);
    expect(folderField("app_folder").matches(":disabled")).toBe(true);
    expect(folderField("vault_folder").matches(":disabled")).toBe(true);
    expect(pickButton("vault_folder").matches(":disabled")).toBe(true);

    fireEvent.click(radio("vault_folder"));
    expect(folderField("vault_folder").matches(":disabled")).toBe(false);
    expect(folderField("app_folder").matches(":disabled")).toBe(true);
  });

  it("still opens the folder picker from its button", async () => {
    pickFolder.mockResolvedValueOnce("/media/picked");
    show(true);
    fireEvent.click(radio("vault_folder"));
    fireEvent.click(pickButton("vault_folder"));
    await waitFor(() => expect(folderField("vault_folder").value).toBe("/media/picked"));
    expect(needsStep("vault_folder")).toBe(false);
  });
});
