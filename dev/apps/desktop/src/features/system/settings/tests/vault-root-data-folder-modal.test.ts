/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultAppSettings, type AppSettingsConfig } from "@upriv/shared";
import type { DataFolderExportJob } from "@upriv/shared/react";
import type { DataFolderExportControls } from "@/features/system/data-folder-export";
import { pressStop } from "@/lib/tests/pressStop";
import { VaultRootDataFolderModal } from "../VaultRootDataFolderModal";

let settings: AppSettingsConfig = createDefaultAppSettings();
const pickFolder = vi.fn<(initial: string | null, title: string) => Promise<string | null>>();
const setupDefaultRoot = vi.fn<() => Promise<{ rootPath: string }>>();

vi.mock("@/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("@/lib/appVersion", () => ({
  getAppVersion: async () => ({ distribution: "portable" }),
  getSessionAppVersion: () => null,
}));
vi.mock("../AppSettingsContext", () => ({
  useAppSettingsContext: () => ({ settings, patchSettings: async () => true }),
}));
vi.mock("@/platform/services", () => {
  // One object, as the real provider gives: effects keyed on it run once.
  const service = {
    pickFolder: (initial: string | null, title: string) => pickFolder(initial, title),
    defaultRootStatus: async () => ({ status: "valid", defaultRootAnchor: "/app" }),
    inspectAtPath: async () => ({ status: "valid" }),
    readAlias: async () => ({ path: "/data/other" }),
    suggestedCustomRootPath: async () => "",
    setupDefaultRoot: () => setupDefaultRoot(),
  };
  return { useVaultRootService: () => service };
});

const DEFAULT_TITLE = "modal.app_settings.option.upriv_root.default_root";
const CUSTOM_TITLE = "modal.app_settings.option.upriv_root.custom_root";
const EXPORT_TITLE = "modal.data_folder_export.title";

function controls(patch: Partial<DataFolderExportControls> = {}): DataFolderExportControls {
  return {
    canStart: true,
    job: null,
    written: null,
    clearWritten: vi.fn(),
    onStart: vi.fn(() => true),
    onStop: vi.fn(),
    ...patch,
  };
}

const running: DataFolderExportJob = {
  id: "job-running",
  startedAt: Date.now(),
  progress: null,
  stoppingSince: null,
};

function show(
  exportControls: DataFolderExportControls,
  extra: { vaultActivityBlocksChange?: boolean; onDirtyChange?: (dirty: boolean) => void } = {},
) {
  return render(
    createElement(VaultRootDataFolderModal, {
      open: true,
      onClose: () => {},
      exportControls,
      ...extra,
    }),
  );
}

function footerButton(name: string): HTMLElement | null {
  return screen.queryByRole("button", { name });
}

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

beforeEach(() => {
  // The picker is cancelled unless a test picks a folder.
  pickFolder.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  pickFolder.mockReset();
  settings = createDefaultAppSettings();
});

function nameInput(): HTMLInputElement {
  return screen.getByLabelText("modal.data_folder_export.name_label");
}

function folderInput(): HTMLInputElement {
  return screen.getByLabelText("modal.export_folder.label");
}

/** Disabled by itself or by the option's fieldset. */
function inactive(element: HTMLElement): boolean {
  return element.matches(":disabled");
}

/** The option's card wears the attention border: chosen and a step is left. */
function needsStep(title: string): boolean {
  const card = screen.getByText(title).closest("label");
  return card?.className.includes("vault-status-recovery") ?? false;
}

const DEFAULT_NAME = /^upriv-\d{4}-\d{2}-\d{2}-\d{6}$/;

describe("VaultRootDataFolderModal export choice", () => {
  it("swaps Apply for Export, and a folder option brings Apply back", async () => {
    show(controls());
    expect(footerButton("action.apply")).not.toBeNull();

    fireEvent.click(screen.getByText(EXPORT_TITLE));
    expect(footerButton("action.apply")).toBeNull();
    expect(footerButton("modal.data_folder_export.confirm")).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByText(DEFAULT_TITLE));
    await waitFor(() => expect(footerButton("action.apply")).not.toBeNull());
    expect(footerButton("modal.data_folder_export.confirm")).toBeNull();
  });

  it("drops a folder draft when Export a copy is chosen", async () => {
    const onDirtyChange = vi.fn();
    show(controls(), { onDirtyChange });

    fireEvent.click(screen.getByText(CUSTOM_TITLE));
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));

    fireEvent.click(screen.getByText(EXPORT_TITLE));
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    expect(footerButton("modal.data_folder_export.confirm")).not.toBeNull();
  });

  it("shows Export a copy's fields before it is chosen, inactive until then", () => {
    show(controls());
    expect(inactive(nameInput())).toBe(true);
    expect(inactive(folderInput())).toBe(true);
    expect(inactive(screen.getByRole("button", { name: "modal.export_folder.choose" }))).toBe(true);

    fireEvent.click(screen.getByText(EXPORT_TITLE));
    expect(inactive(nameInput())).toBe(false);
    expect(inactive(folderInput())).toBe(false);
  });

  it("opens nothing when Export a copy is chosen, and marks it until a folder is set", () => {
    show(controls());

    fireEvent.click(screen.getByText(EXPORT_TITLE));
    expect(pickFolder).not.toHaveBeenCalled();
    expect(needsStep(EXPORT_TITLE)).toBe(true);
    expect(footerButton("modal.data_folder_export.confirm")).toHaveProperty("disabled", true);

    fireEvent.change(folderInput(), { target: { value: "/media/usb" } });
    expect(needsStep(EXPORT_TITLE)).toBe(false);
    expect(footerButton("modal.data_folder_export.confirm")).toHaveProperty("disabled", false);
  });

  it("takes a folder from Choose folder or typed, and refuses a relative one", async () => {
    pickFolder.mockResolvedValue("/media/usb");
    show(controls());
    fireEvent.click(screen.getByText(EXPORT_TITLE));

    fireEvent.click(screen.getByRole("button", { name: "modal.export_folder.choose" }));
    await waitFor(() => expect(folderInput().value).toBe("/media/usb"));

    fireEvent.change(folderInput(), { target: { value: "Downloads" } });
    expect(screen.getByText("modal.workspace.error.not_absolute")).toBeDefined();
    expect(needsStep(EXPORT_TITLE)).toBe(true);
    expect(footerButton("modal.data_folder_export.confirm")).toHaveProperty("disabled", true);
  });

  it("exports the named zip into the chosen folder from the footer", () => {
    const exportControls = controls();
    show(exportControls);

    fireEvent.click(screen.getByText(EXPORT_TITLE));
    expect(nameInput().value).toMatch(DEFAULT_NAME);
    fireEvent.change(folderInput(), { target: { value: " /media/usb " } });
    fireEvent.change(nameInput(), { target: { value: " trip copy.zip " } });

    act(() => {
      footerButton("modal.data_folder_export.confirm")?.click();
    });
    expect(exportControls.onStart).toHaveBeenCalledWith("/media/usb", "trip copy");
  });

  it("goes from the name to the folder picker on Enter, then exports", async () => {
    pickFolder.mockResolvedValue("/media/usb");
    const exportControls = controls();
    show(exportControls);
    fireEvent.click(screen.getByText(EXPORT_TITLE));

    // A name that cannot be used keeps Enter in its field.
    fireEvent.change(nameInput(), { target: { value: "trip/copy" } });
    fireEvent.keyDown(nameInput(), { key: "Enter" });
    expect(pickFolder).not.toHaveBeenCalled();

    fireEvent.change(nameInput(), { target: { value: "trip copy" } });
    fireEvent.keyDown(nameInput(), { key: "Enter" });
    expect(pickFolder).toHaveBeenCalledWith(null, "modal.data_folder_export.picker_title");
    expect(document.activeElement).toBe(folderInput());
    expect(exportControls.onStart).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(footerButton("modal.data_folder_export.confirm")).toHaveProperty("disabled", false),
    );
    expect(folderInput().value).toBe("/media/usb");

    fireEvent.keyDown(nameInput(), { key: "Enter" });
    expect(exportControls.onStart).toHaveBeenCalledWith("/media/usb", "trip copy");
    expect(pickFolder).toHaveBeenCalledOnce();
  });

  it("keeps the folder after an export, while the name starts over", () => {
    const exportControls = controls();
    const view = show(exportControls);
    fireEvent.click(screen.getByText(EXPORT_TITLE));
    fireEvent.change(folderInput(), { target: { value: "/media/usb" } });
    fireEvent.change(nameInput(), { target: { value: "trip copy" } });
    act(() => {
      footerButton("modal.data_folder_export.confirm")?.click();
    });

    view.rerender(
      createElement(VaultRootDataFolderModal, {
        open: true,
        onClose: () => {},
        exportControls: {
          ...exportControls,
          written: { path: "/media/usb/trip copy.zip", size: 1 },
        },
      }),
    );
    expect(folderInput().value).toBe("/media/usb");
    expect(nameInput().value).toMatch(DEFAULT_NAME);
    expect(footerButton("modal.data_folder_export.confirm")).toHaveProperty("disabled", false);
  });

  it("turns Export off and says why while the name cannot be used", () => {
    show(controls());
    fireEvent.click(screen.getByText(EXPORT_TITLE));
    fireEvent.change(folderInput(), { target: { value: "/media/usb" } });
    expect(footerButton("modal.data_folder_export.confirm")).toHaveProperty("disabled", false);

    fireEvent.change(nameInput(), { target: { value: "trip/copy" } });
    expect(needsStep(EXPORT_TITLE)).toBe(true);
    expect(screen.getByText("error.data_folder_export_name_invalid")).toBeDefined();
    expect(footerButton("modal.data_folder_export.confirm")).toHaveProperty("disabled", true);

    fireEvent.change(nameInput(), { target: { value: "" } });
    expect(screen.queryByText("error.data_folder_export_name_invalid")).toBeNull();
    expect(footerButton("modal.data_folder_export.confirm")).toHaveProperty("disabled", true);
  });

  it("starts a fresh name after an export, and keeps a typed one after a failure", () => {
    const exportControls = controls();
    const view = show(exportControls);
    fireEvent.click(screen.getByText(EXPORT_TITLE));
    fireEvent.change(nameInput(), { target: { value: "trip copy" } });

    // A failed export ends with nothing written.
    view.rerender(
      createElement(VaultRootDataFolderModal, {
        open: true,
        onClose: () => {},
        exportControls: { ...exportControls },
      }),
    );
    expect(nameInput().value).toBe("trip copy");

    view.rerender(
      createElement(VaultRootDataFolderModal, {
        open: true,
        onClose: () => {},
        exportControls: {
          ...exportControls,
          written: { path: "/media/usb/trip copy.zip", size: 1 },
        },
      }),
    );
    expect(nameInput().value).toMatch(DEFAULT_NAME);
  });

  it("says the zip was saved by name, without its path", () => {
    show(controls({ written: { path: "/media/usb/trip copy.zip", size: 1 } }));
    expect(screen.getByText("modal.data_folder_export.done")).toBeDefined();
    expect(screen.queryByDisplayValue("/media/usb/trip copy.zip")).toBeNull();
  });

  it("drops the saved line when the window opens and when it closes", () => {
    const exportControls = controls();
    const view = show(exportControls);
    expect(exportControls.clearWritten).toHaveBeenCalledTimes(1);

    view.rerender(
      createElement(VaultRootDataFolderModal, { open: false, onClose: () => {}, exportControls }),
    );
    expect(exportControls.clearWritten).toHaveBeenCalledTimes(2);
  });

  it("keeps Export a copy chosen while it runs and offers Stop", () => {
    const exportControls = controls({ canStart: false, job: running });
    show(exportControls, { vaultActivityBlocksChange: true });

    fireEvent.click(screen.getByText(DEFAULT_TITLE));
    expect(footerButton("action.apply")).toBeNull();

    const stop = footerButton("modal.data_folder_export.stop");
    expect(stop).not.toBeNull();
    act(() => pressStop(stop as HTMLElement));
    expect(exportControls.onStop).toHaveBeenCalledTimes(1);
  });

  it("says what the running copy is doing", () => {
    const lines = [
      "modal.data_folder_export.measuring",
      "modal.data_folder_export.progress",
      "modal.data_folder_export.finishing",
    ];
    const shown = () => lines.filter((line) => screen.queryByText(line) !== null);
    const at = (progress: DataFolderExportJob["progress"]) =>
      createElement(VaultRootDataFolderModal, {
        open: true,
        onClose: () => {},
        exportControls: controls({ canStart: false, job: { ...running, progress } }),
      });
    const view = render(at(null));
    expect(shown()).toEqual(["modal.data_folder_export.measuring"]);
    view.rerender(at({ bytesDone: 10, bytesTotal: 40, stoppable: true }));
    expect(shown()).toEqual(["modal.data_folder_export.progress"]);
    view.rerender(at({ bytesDone: 40, bytesTotal: 40, stoppable: false }));
    expect(shown()).toEqual(["modal.data_folder_export.finishing"]);
  });

  it("marks the folder in use", () => {
    show(controls());
    expect(screen.getAllByText("modal.settings.badge.in_use")).toHaveLength(1);
  });

  it("titles Export a copy apart from the folder options, with a subtitle", () => {
    show(controls());
    const heading = screen.getByRole("heading", { name: "modal.data_folder.copy_heading" });
    const hint = screen.getByText("modal.data_folder.copy_hint");
    const exportOption = screen.getByText(EXPORT_TITLE);
    const customOption = screen.getByText(CUSTOM_TITLE);
    const follows = (before: Node, after: Node) =>
      Boolean(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(customOption, heading)).toBe(true);
    expect(follows(heading, hint)).toBe(true);
    expect(follows(hint, exportOption)).toBe(true);
    expect(screen.getByText("modal.app_settings.field.upriv_root_mode_help")).toBeDefined();
  });
});

describe("VaultRootDataFolderModal apply", () => {
  /** Apply the default folder while the custom one is in use; the setup waits for `finish`. */
  async function applyDefault(onClose: () => void, onNotice: (message: string) => void) {
    settings = {
      ...createDefaultAppSettings(),
      app: {
        ...createDefaultAppSettings().app,
        vault_root_mode: "custom_root",
        upriv_root_path: "/data/other",
      },
    };
    let finish: () => void = () => undefined;
    setupDefaultRoot.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ rootPath: "/app" });
        }),
    );
    const props = { open: true, onClose, onNotice, exportControls: controls() };
    const view = render(createElement(VaultRootDataFolderModal, props));
    fireEvent.click(screen.getByText(DEFAULT_TITLE));
    // The folder check settles first; a change of its result closes an open confirm.
    await waitFor(() => {
      const apply = footerButton("action.apply");
      if (apply) fireEvent.click(apply);
      expect(footerButton("modal.data_folder.apply_confirm_action")).not.toBeNull();
    });
    fireEvent.click(footerButton("modal.data_folder.apply_confirm_action") as HTMLElement);
    await waitFor(() => expect(setupDefaultRoot).toHaveBeenCalledTimes(1));
    return { view, props, finish: () => finish() };
  }

  it("closes while Apply runs, and the list toast reports how it ended", async () => {
    const onClose = vi.fn();
    const onNotice = vi.fn();
    const { view, props, finish } = await applyDefault(onClose, onNotice);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    view.rerender(createElement(VaultRootDataFolderModal, { ...props, open: false }));

    await act(async () => finish());
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith("modal.data_folder.applied"));
  });
});
