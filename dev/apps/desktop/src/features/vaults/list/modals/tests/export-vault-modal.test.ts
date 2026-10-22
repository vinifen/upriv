/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { VaultExportRequest, VaultExportRun, VaultListItem } from "@upriv/shared";
import { useVaultExportFolders } from "../../hooks/useVaultExportFolders";
import { ExportVaultModal } from "../ExportVaultModal";

const pickFolder = vi.fn<(initial: string | null, title: string) => Promise<string | null>>();

// The same service objects on every render, as the app's context gives them.
const services = vi.hoisted(() => ({
  vaultRoot: {} as { pickFolder?: unknown },
  vault: {
    getSettings: async () => null,
    exportCapabilities: async () => ({ sevenZip: true }),
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

interface HarnessProps {
  onConfirm: (request: VaultExportRequest, dir: string) => void;
  onPasswordEdited?: () => void;
  running?: VaultExportRun | null;
  passwordError?: string | null;
}

/** The window with the folders the vault list keeps. */
function Harness({ onConfirm, onPasswordEdited, running, passwordError }: HarnessProps) {
  const folders = useVaultExportFolders();
  return createElement(ExportVaultModal, {
    vault,
    open: true,
    running,
    passwordError,
    folders,
    onClose: () => {},
    onConfirm,
    onPasswordEdited,
  });
}

function show(props: Omit<HarnessProps, "onConfirm"> = {}) {
  const onConfirm = vi.fn<(request: VaultExportRequest, dir: string) => void>();
  render(createElement(Harness, { onConfirm, ...props }));
  return onConfirm;
}

async function capabilitiesLoaded() {
  await waitFor(() => expect(screen.getByText("vault.export.option.seven_zip_desc")).toBeDefined());
}

function card(title: string): HTMLElement {
  const label = screen.getByText(title).closest("label");
  if (!label) throw new Error(`no card for ${title}`);
  return label;
}

function radio(title: string): HTMLInputElement {
  const input = card(title).querySelector<HTMLInputElement>('input[type="radio"]');
  if (!input) throw new Error(`no radio for ${title}`);
  return input;
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
  return card(title).className.includes("vault-status-recovery");
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
    await capabilitiesLoaded();
    fireEvent.change(folderInputs()[0], { target: { value: "/media/zips" } });
    fireEvent.click(screen.getByText(SEVEN_ZIP_TITLE));

    const below = Boolean(
      passwordInput().compareDocumentPosition(folderInputs()[1]) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(below).toBe(true);
    expect(needsStep(SEVEN_ZIP_TITLE)).toBe(true);

    fireEvent.change(passwordInput(), { target: { value: "vault password" } });
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

  it("goes from the .7z password to its folder picker on Enter, then exports", async () => {
    pickFolder.mockResolvedValue("/media/sevens");
    const onConfirm = show();
    await capabilitiesLoaded();
    fireEvent.click(screen.getByText(SEVEN_ZIP_TITLE));
    fireEvent.keyDown(passwordInput(), { key: "Enter" });
    expect(pickFolder).not.toHaveBeenCalled();

    fireEvent.change(passwordInput(), { target: { value: "vault password" } });
    fireEvent.keyDown(passwordInput(), { key: "Enter" });
    expect(pickFolder).toHaveBeenCalledWith(null, "vault.export.dialog.picker_title.seven_zip");
    expect(document.activeElement).toBe(folderInputs()[1]);
    expect(onConfirm).not.toHaveBeenCalled();
    await waitFor(() => expect(exportButton().disabled).toBe(false));
    expect(folderInputs()[1].value).toBe("/media/sevens");

    fireEvent.keyDown(passwordInput(), { key: "Enter" });
    expect(pickFolder).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ format: "seven_zip", password: "vault password" }),
      "/media/sevens",
    );
  });

  it("keeps its choices when the vault list re-renders it", async () => {
    const { rerender } = render(createElement(Harness, { onConfirm: vi.fn() }));
    await capabilitiesLoaded();
    fireEvent.click(screen.getByText(SEVEN_ZIP_TITLE));
    fireEvent.change(passwordInput(), { target: { value: "vault password" } });

    rerender(createElement(Harness, { onConfirm: vi.fn(), onPasswordEdited: vi.fn() }));
    await capabilitiesLoaded();
    expect(radio(SEVEN_ZIP_TITLE).checked).toBe(true);
    expect(passwordInput().value).toBe("vault password");
  });

  it("marks a refused password on its field and waits until it is edited", async () => {
    const onPasswordEdited = vi.fn();
    const onConfirm = show({ passwordError: "error.wrong_password", onPasswordEdited });
    await capabilitiesLoaded();
    fireEvent.click(screen.getByText(SEVEN_ZIP_TITLE));
    fireEvent.change(folderInputs()[1], { target: { value: "/media/sevens" } });
    onPasswordEdited.mockClear();

    expect(passwordInput().getAttribute("aria-invalid")).toBe("true");
    expect(within(card(SEVEN_ZIP_TITLE)).getByRole("alert").textContent).toBe(
      "error.wrong_password",
    );
    expect(needsStep(SEVEN_ZIP_TITLE)).toBe(true);
    expect(exportButton().disabled).toBe(true);
    fireEvent.keyDown(passwordInput(), { key: "Enter" });
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.change(passwordInput(), { target: { value: "another try" } });
    expect(onPasswordEdited).toHaveBeenCalled();
  });

  it("locks the options and shows the running export inside its own option", async () => {
    show({
      running: {
        format: "seven_zip",
        startedAt: Date.now(),
        progress: { bytesDone: 512, bytesTotal: 2048 },
      },
    });
    await capabilitiesLoaded();

    expect(radio(SEVEN_ZIP_TITLE).checked).toBe(true);
    expect(radio(ZIP_TITLE).disabled).toBe(true);
    const bar = within(card(SEVEN_ZIP_TITLE)).getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("25");
    expect(within(card(SEVEN_ZIP_TITLE)).getByRole("status").textContent).toBe(
      "vault.export.dialog.progress",
    );
    expect(within(card(ZIP_TITLE)).queryByRole("progressbar")).toBeNull();
    // The running option shows its progress in place of its fields.
    expect(screen.queryByLabelText("vault.export.dialog.seven_zip_password")).toBeNull();
    const exporting = screen.getByRole("button", { name: "vault.export.dialog.submitting" });
    expect((exporting as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows a running .zip export in the .zip option", async () => {
    show({ running: { format: "store_zip", startedAt: Date.now(), progress: null } });
    await capabilitiesLoaded();

    expect(radio(ZIP_TITLE).checked).toBe(true);
    expect(radio(SEVEN_ZIP_TITLE).disabled).toBe(true);
    expect(within(card(ZIP_TITLE)).getByRole("status").textContent).toBe(
      "vault.export.dialog.measuring",
    );
    expect(within(card(SEVEN_ZIP_TITLE)).queryByRole("progressbar")).toBeNull();
  });

  it("refuses a relative folder", () => {
    show();
    fireEvent.change(folderInputs()[0], { target: { value: "Downloads" } });
    expect(screen.getByText("modal.workspace.error.not_absolute")).toBeDefined();
    expect(exportButton().disabled).toBe(true);
  });
});
