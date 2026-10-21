/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { VaultExportRequest, VaultListItem } from "@upriv/shared";
import { useVaultExportFolders } from "../../hooks/useVaultExportFolders";
import { ExportVaultModal } from "../ExportVaultModal";

const pickFolder = vi.fn<(initial: string | null, title: string) => Promise<string | null>>();

// The same service objects on every render, as the app's context gives them.
const services = vi.hoisted(() => ({
  vaultRoot: {} as { pickFolder?: unknown },
  vault: {
    getSettings: async () => null,
    exportCapabilities: async () => ({ sevenZip: true }),
    probeExportPassword: async () => true,
  },
  toast: { showError: () => {} },
}));
services.vaultRoot.pickFolder = pickFolder;

vi.mock("@/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("@/hooks/useErrorToast", () => ({ useErrorToast: () => services.toast }));
vi.mock("@/platform/services", () => ({
  useVaultRootService: () => services.vaultRoot,
  useVaultService: () => services.vault,
}));

const vault: VaultListItem = {
  id: "notes",
  displayName: "Notes",
  session: null,
  storageMode: "encrypted_dir",
  lastAccessedWhen: "just now",
  lastAccessedAt: "2026-06-01T12:00:00.000Z",
  note: "",
};

const ZIP_TITLE = "vault.export.option.store_zip";
const SEVEN_ZIP_TITLE = "vault.export.option.seven_zip";

/** The window with the folders the vault list keeps. */
function Harness({ onConfirm }: { onConfirm: (request: VaultExportRequest, dir: string) => void }) {
  const folders = useVaultExportFolders();
  return createElement(ExportVaultModal, {
    vault,
    open: true,
    folders,
    onClose: () => {},
    onConfirm,
  });
}

function show() {
  const onConfirm = vi.fn<(request: VaultExportRequest, dir: string) => void>();
  render(createElement(Harness, { onConfirm }));
  return onConfirm;
}

function exportButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "vault.export.dialog.confirm" });
}

/** The `.zip` folder field, then the `.7z` one. */
function folderInputs(): HTMLInputElement[] {
  return screen.getAllByLabelText("modal.export_folder.label");
}

function passwordInput(): HTMLInputElement {
  return screen.getByLabelText("vault.export.dialog.seven_zip_password");
}

function needsStep(title: string): boolean {
  const card = screen.getByText(title).closest("label");
  return card?.className.includes("vault-status-recovery") ?? false;
}

function inactive(element: HTMLElement): boolean {
  return element.matches(":disabled");
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

describe("ExportVaultModal", () => {
  it("asks for the .zip folder before Export, and exports into it", async () => {
    const onConfirm = show();
    await waitFor(() =>
      expect(screen.getByText("vault.export.option.seven_zip_desc")).toBeDefined(),
    );
    expect(needsStep(ZIP_TITLE)).toBe(true);
    expect(exportButton().disabled).toBe(true);
    expect(pickFolder).not.toHaveBeenCalled();

    fireEvent.change(folderInputs()[0], { target: { value: " /media/usb " } });
    expect(needsStep(ZIP_TITLE)).toBe(false);
    act(() => exportButton().click());
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ format: "store_zip", password: undefined }),
      "/media/usb",
    );
  });

  it("picks the .zip folder from its own Choose folder button", async () => {
    pickFolder.mockResolvedValue("/media/usb");
    show();
    const [zipChoose] = screen.getAllByRole("button", { name: "modal.export_folder.choose" });
    fireEvent.click(zipChoose);
    await waitFor(() => expect(folderInputs()[0].value).toBe("/media/usb"));
    expect(pickFolder).toHaveBeenCalledWith(null, "vault.export.dialog.picker_title.store_zip");
  });

  it("shows the .7z password and folder before it is chosen, inactive until then", async () => {
    show();
    await waitFor(() =>
      expect(screen.getByText("vault.export.option.seven_zip_desc")).toBeDefined(),
    );
    expect(inactive(passwordInput())).toBe(true);
    expect(inactive(folderInputs()[1])).toBe(true);
    expect(inactive(folderInputs()[0])).toBe(false);

    fireEvent.click(screen.getByText(SEVEN_ZIP_TITLE));
    expect(inactive(passwordInput())).toBe(false);
    expect(inactive(folderInputs()[1])).toBe(false);
    expect(inactive(folderInputs()[0])).toBe(true);
  });

  it("takes the .7z folder under its password, and waits for both", async () => {
    const onConfirm = show();
    await waitFor(() =>
      expect(screen.getByText("vault.export.option.seven_zip_desc")).toBeDefined(),
    );
    fireEvent.change(folderInputs()[0], { target: { value: "/media/zips" } });
    fireEvent.click(screen.getByText(SEVEN_ZIP_TITLE));

    const below = Boolean(
      passwordInput().compareDocumentPosition(folderInputs()[1]) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(below).toBe(true);
    expect(needsStep(SEVEN_ZIP_TITLE)).toBe(true);

    fireEvent.change(passwordInput(), { target: { value: "vault password" } });
    await act(async () => {
      screen.getByRole("button", { name: "vault.export.dialog.seven_zip_password_check" }).click();
    });
    await waitFor(() =>
      expect(screen.getByText("vault.export.dialog.seven_zip_password_ok")).toBeDefined(),
    );
    // The .zip folder does not stand in for the .7z one.
    expect(exportButton().disabled).toBe(true);
    expect(needsStep(SEVEN_ZIP_TITLE)).toBe(true);

    fireEvent.change(folderInputs()[1], { target: { value: "/media/sevens" } });
    expect(needsStep(SEVEN_ZIP_TITLE)).toBe(false);
    act(() => exportButton().click());
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ format: "seven_zip", password: "vault password" }),
      "/media/sevens",
    );
  });

  it("refuses a relative folder", () => {
    show();
    fireEvent.change(folderInputs()[0], { target: { value: "Downloads" } });
    expect(screen.getByText("modal.workspace.error.not_absolute")).toBeDefined();
    expect(exportButton().disabled).toBe(true);
  });
});
