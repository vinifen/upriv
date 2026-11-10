/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataFolderExportPanel } from "../DataFolderExportPanel";
import type {
  DataFolderExportControls,
  DataFolderExportDestination,
} from "../dataFolderExportTypes";

vi.mock("@/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/platform/services", () => ({ useVaultRootService: () => ({}) }));

const SWITCH = "modal.data_folder_export.include_backups";
const OUTSIDE = "modal.data_folder_export.outside_backups";

function controls(patch: Partial<DataFolderExportControls> = {}): DataFolderExportControls {
  return {
    canStart: true,
    job: null,
    written: null,
    clearWritten: vi.fn(),
    outsideBackups: 0,
    onStart: vi.fn(() => true),
    onStop: vi.fn(),
    ...patch,
  };
}

function destination(
  patch: Partial<DataFolderExportDestination> = {},
): DataFolderExportDestination {
  return {
    folder: {
      path: "/media/usb",
      setPath: vi.fn(),
      picking: false,
      pickFailed: false,
      fieldRef: { current: null },
      choose: vi.fn(),
      chooseIfMissing: vi.fn(() => false),
      cancelPick: vi.fn(),
    },
    zipName: "trip copy",
    setZipName: vi.fn(),
    resetZipName: vi.fn(),
    includeBackups: true,
    setIncludeBackups: vi.fn(),
    ...patch,
  };
}

function show(panelControls = controls(), panelDestination = destination()) {
  render(
    createElement(DataFolderExportPanel, {
      controls: panelControls,
      destination: panelDestination,
    }),
  );
  return { panelControls, panelDestination };
}

describe("DataFolderExportPanel backups", () => {
  afterEach(cleanup);

  it("shows the switch on, and asks for the change", () => {
    const { panelDestination } = show();
    const control = screen.getByLabelText(SWITCH);
    expect(control.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(control);
    expect(panelDestination.setIncludeBackups).toHaveBeenCalledWith(false);
  });

  it("sends the choice with the export", () => {
    const { panelControls } = show(controls(), destination({ includeBackups: false }));
    fireEvent.keyDown(screen.getByDisplayValue("trip copy"), { key: "Enter" });
    expect(panelControls.onStart).toHaveBeenCalledWith("/media/usb", "trip copy", false);
  });

  it("counts the vaults with backups outside, only when there are some", () => {
    show();
    expect(screen.queryByText(OUTSIDE)).toBeNull();
    cleanup();
    show(controls({ outsideBackups: 2 }));
    expect(screen.getByText(OUTSIDE)).toBeDefined();
  });
});
