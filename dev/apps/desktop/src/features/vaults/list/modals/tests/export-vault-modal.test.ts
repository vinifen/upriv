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
const PLAIN_TITLE = "vault.export.option.plain_zip";
const PASSWORD_LABEL = "vault.export.dialog.vault_password";

interface HarnessProps {
  onConfirm: (request: VaultExportRequest, dir: string) => void;
  onStop?: () => void;
  onPasswordEdited?: () => void;
  running?: VaultExportRun | null;
  passwordError?: string | null;
}

/** The window with the folders the vault list keeps. */
function Harness({
  onConfirm,
  onStop = () => {},
  onPasswordEdited,
  running,
  passwordError,
}: HarnessProps) {
  const folders = useVaultExportFolders();
  return createElement(ExportVaultModal, {
    vault,
    open: true,
    running,
    passwordError,
    folders,
    onClose: () => {},
    onConfirm,
    onStop,
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

/** The `.zip` folder field, then the `.7z` one, then the plain-text one. */
function folderInputs(): HTMLInputElement[] {
  return screen.getAllByLabelText("modal.export_folder.label");
}

/** The password field of the `.7z` option, or of the option named by `title`. */
function passwordInput(title = SEVEN_ZIP_TITLE): HTMLInputElement {
  return within(card(title)).getByLabelText(PASSWORD_LABEL);
}

function includeSwitch(title: string, label: string): HTMLElement {
  return within(card(title)).getByLabelText(label);
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
    expect(within(card(SEVEN_ZIP_TITLE)).queryByLabelText(PASSWORD_LABEL)).toBeNull();
    // The one footer button stops the export instead of starting one.
    expect(screen.queryByRole("button", { name: "vault.export.dialog.confirm" })).toBeNull();
    expect(screen.getByRole("button", { name: "vault.export.dialog.stop" })).toBeDefined();
  });

  it("offers the plain-text .zip last, in red, with its own password and folder", async () => {
    const onConfirm = show();
    await capabilitiesLoaded();

    const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
    const formats = radios.map((input) => input.getAttribute("value"));
    expect(formats.filter((value) => value?.endsWith("_zip"))).toEqual([
      "store_zip",
      "seven_zip",
      "plain_zip",
    ]);
    expect(formats.at(-1)).toBe("plain_zip");
    expect(card(PLAIN_TITLE).textContent).toContain("modal.settings.badge.insecure");
    expect(card(PLAIN_TITLE).className).toContain("--danger-border");

    fireEvent.click(screen.getByText(PLAIN_TITLE));
    expect(radio(PLAIN_TITLE).checked).toBe(true);
    expect(card(PLAIN_TITLE).className).toContain("vault-status-recovery");
    expect(exportButton().disabled).toBe(true);

    fireEvent.change(passwordInput(PLAIN_TITLE), { target: { value: "vault password" } });
    expect(needsStep(PLAIN_TITLE)).toBe(true);
    fireEvent.change(folderInputs()[2], { target: { value: "/media/plain" } });
    expect(needsStep(PLAIN_TITLE)).toBe(false);
    expect(card(PLAIN_TITLE).className).toContain("--danger-border");
    expect(passwordInput().value).toBe("");

    fireEvent.click(exportButton());
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        format: "plain_zip",
        password: "vault password",
        include: { workspace: true, settings: true },
      }),
      "/media/plain",
    );
  });

  it("keeps each option's toggles apart, on by default", async () => {
    const onConfirm = show();
    await capabilitiesLoaded();
    const layout = "vault.export.dialog.include_workspace";
    const settings = "vault.export.dialog.include_settings";
    expect(within(card(ZIP_TITLE)).queryByLabelText(layout)).toBeNull();

    fireEvent.click(screen.getByText(SEVEN_ZIP_TITLE));
    fireEvent.click(includeSwitch(SEVEN_ZIP_TITLE, layout));
    fireEvent.change(passwordInput(), { target: { value: "vault password" } });
    fireEvent.change(folderInputs()[1], { target: { value: "/media/sevens" } });
    fireEvent.click(exportButton());
    expect(onConfirm).toHaveBeenLastCalledWith(
      expect.objectContaining({ include: { workspace: false, settings: true } }),
      "/media/sevens",
    );

    fireEvent.click(screen.getByText(PLAIN_TITLE));
    fireEvent.click(includeSwitch(PLAIN_TITLE, settings));
    fireEvent.change(passwordInput(PLAIN_TITLE), { target: { value: "vault password" } });
    fireEvent.change(folderInputs()[2], { target: { value: "/media/plain" } });
    fireEvent.click(exportButton());
    expect(onConfirm).toHaveBeenLastCalledWith(
      expect.objectContaining({ include: { workspace: true, settings: false } }),
      "/media/plain",
    );
  });

  it("shows a refusal only on the option that got it and clears it on a new choice", async () => {
    const onPasswordEdited = vi.fn();
    show({ passwordError: "error.wrong_password", onPasswordEdited });
    await capabilitiesLoaded();
    fireEvent.click(screen.getByText(PLAIN_TITLE));
    expect(onPasswordEdited).toHaveBeenCalled();
    expect(within(card(PLAIN_TITLE)).getByRole("alert").textContent).toBe("error.wrong_password");
    expect(within(card(SEVEN_ZIP_TITLE)).queryByRole("alert")).toBeNull();
  });

  it("stops a running export once, then waits for it to settle", async () => {
    const onStop = vi.fn();
    const running = { format: "store_zip" as const, startedAt: Date.now(), progress: null };
    const { rerender } = render(createElement(Harness, { onConfirm: vi.fn(), onStop, running }));
    await capabilitiesLoaded();

    fireEvent.click(screen.getByRole("button", { name: "vault.export.dialog.stop" }));
    expect(onStop).toHaveBeenCalledTimes(1);

    rerender(
      createElement(Harness, {
        onConfirm: vi.fn(),
        onStop,
        running: { ...running, stopping: true },
      }),
    );
    const stopping = screen.getByRole("button", { name: "vault.export.dialog.stopping" });
    expect((stopping as HTMLButtonElement).disabled).toBe(true);
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
