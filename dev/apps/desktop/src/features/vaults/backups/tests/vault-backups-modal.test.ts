/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { VaultBackupEntry, VaultListItem } from "@upriv/shared";
import type { BackupExportJob } from "@upriv/shared/react";
import { useExportFolder } from "@/hooks/useExportFolder";
import { VaultBackupsModal } from "../VaultBackupsModal";

const pickFolder = vi.fn<(initial: string | null, title: string) => Promise<string | null>>();

const PIN: VaultBackupEntry = {
  stamp: "20260102000000",
  fileName: "20260102000000-notes.zip",
  createdAt: "2026-01-02T00:00:00.000Z",
  sizeBytes: 2048,
  saved: true,
};
const PLAIN: VaultBackupEntry = {
  stamp: "20260101000000",
  fileName: "20260101000000-notes.zip",
  createdAt: "2026-01-01T00:00:00.000Z",
  sizeBytes: 1024,
};
const PIN_KEY = "saves/20260102000000-notes.zip";
const PLAIN_KEY = "20260101000000-notes.zip";

// The same service objects on every render, as the app's context gives them.
const services = vi.hoisted(() => ({
  vaultRoot: {} as { pickFolder?: unknown },
  backups: { listBackups: async (): Promise<unknown[]> => [] },
  toast: {
    toast: null,
    dismiss: () => {},
    showError: () => {},
    errorText: () => "",
  },
}));
services.vaultRoot.pickFolder = pickFolder;
services.backups.listBackups = async () => [PIN, PLAIN];

vi.mock("@/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: "en" }),
}));
vi.mock("@/hooks/useErrorToast", () => ({ useErrorToast: () => services.toast }));
vi.mock("@/platform/services", () => ({
  useBackupService: () => services.backups,
  useVaultRootService: () => services.vaultRoot,
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

interface HarnessProps {
  exportJob?: BackupExportJob | null;
  onExport: (keys: readonly string[], destDir: string) => void;
  onExportBusy?: () => void;
  onStopExport?: () => void;
}

/** The window with the folder the vault list keeps. */
function Harness({
  exportJob = null,
  onExport,
  onExportBusy = () => {},
  onStopExport = () => {},
}: HarnessProps) {
  const exportFolder = useExportFolder("modal.backup.export_picker_title");
  return createElement(VaultBackupsModal, {
    vault,
    open: true,
    canSaveNow: true,
    saving: false,
    saveStartedAt: null,
    onSaveNow: () => {},
    listRefreshToken: 0,
    onClose: () => {},
    exportFolder,
    exportJob,
    onExport,
    onExportBusy,
    onStopExport,
  });
}

async function show(props: Omit<HarnessProps, "onExport"> = {}) {
  const onExport = vi.fn<(keys: readonly string[], destDir: string) => void>();
  render(createElement(Harness, { onExport, ...props }));
  await screen.findByText(PLAIN.fileName ?? "");
  return onExport;
}

function row(entry: VaultBackupEntry): HTMLElement {
  const item = screen.getByText(entry.fileName ?? "").closest("li");
  if (!item) throw new Error(`no row for ${entry.stamp}`);
  return item;
}

function rowButton(entry: VaultBackupEntry, name: string): HTMLButtonElement {
  return within(row(entry)).getByRole("button", { name });
}

function job(keys: readonly string[], overrides: Partial<BackupExportJob> = {}): BackupExportJob {
  return {
    id: "job-1",
    vaultId: "notes",
    keys,
    startedAt: Date.now(),
    progress: { bytesDone: 512, bytesTotal: 1024 },
    stopping: false,
    ...overrides,
  };
}

/** `second` comes after `first` in the page. */
function follows(first: Element, second: Element): boolean {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
  pickFolder.mockReset();
});

describe("VaultBackupsModal export", () => {
  it("picks a folder and exports one backup with no name step", async () => {
    pickFolder.mockResolvedValue("/media/usb");
    const onExport = await show();

    fireEvent.click(rowButton(PLAIN, "modal.backup.export"));
    await waitFor(() => expect(onExport).toHaveBeenCalledWith([PLAIN_KEY], "/media/usb"));
    expect(pickFolder).toHaveBeenCalledWith(null, "modal.backup.export_picker_title");
  });

  it("grows the row with the folder step when the pick is cancelled, so a path can be typed", async () => {
    pickFolder.mockResolvedValue(null);
    const onExport = await show();

    fireEvent.click(rowButton(PLAIN, "modal.backup.export"));
    const field = await within(row(PLAIN)).findByLabelText("modal.export_folder.label");
    await waitFor(() => expect(pickFolder).toHaveBeenCalledOnce());
    fireEvent.change(field, { target: { value: "/media/typed" } });
    fireEvent.click(rowButton(PLAIN, "vault.export.dialog.confirm"));
    expect(onExport).toHaveBeenCalledWith([PLAIN_KEY], "/media/typed");
  });

  it("shows the kept folder and waits for Export, or starts from a new pick", async () => {
    pickFolder.mockResolvedValueOnce("/media/usb");
    const onExport = await show();

    fireEvent.click(rowButton(PLAIN, "modal.backup.export"));
    await waitFor(() => expect(onExport).toHaveBeenCalledOnce());

    fireEvent.click(rowButton(PIN, "modal.backup.export"));
    const field = await within(row(PIN)).findByLabelText("modal.export_folder.label");
    expect((field as HTMLInputElement).value).toBe("/media/usb");
    expect(pickFolder).toHaveBeenCalledOnce();
    expect(onExport).toHaveBeenCalledOnce();

    pickFolder.mockResolvedValueOnce("/media/other");
    fireEvent.click(rowButton(PIN, "modal.export_folder.choose"));
    await waitFor(() => expect(onExport).toHaveBeenLastCalledWith([PIN_KEY], "/media/other"));
  });

  it("puts the step for several above the Saves list, under the toolbar", async () => {
    pickFolder.mockResolvedValue(null);
    const onExport = await show();

    fireEvent.click(screen.getByLabelText("modal.backup.select_all"));
    fireEvent.click(screen.getByRole("button", { name: "modal.backup.export_selected" }));

    const title = await screen.findByText("modal.backup.export_count");
    const toolbar = screen.getByLabelText("modal.backup.select_all");
    const saves = screen.getByText("modal.backup.section.saves");
    expect(follows(toolbar, title)).toBe(true);
    expect(follows(title, saves)).toBe(true);
    expect(within(row(PIN)).queryByLabelText("modal.export_folder.label")).toBeNull();

    await waitFor(() => expect(pickFolder).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText("modal.export_folder.label"), {
      target: { value: "/media/typed" },
    });
    fireEvent.submit(screen.getByLabelText("modal.export_folder.label"));
    expect(onExport).toHaveBeenCalledWith([PIN_KEY, PLAIN_KEY], "/media/typed");
  });

  it("shows the bar of one backup in its row, and locks only that row", async () => {
    const onStopExport = vi.fn();
    await show({ exportJob: job([PLAIN_KEY]), onStopExport });

    expect(within(row(PLAIN)).getByRole("progressbar")).toBeDefined();
    expect(within(row(PIN)).queryByRole("progressbar")).toBeNull();
    expect(rowButton(PLAIN, "action.delete").disabled).toBe(true);
    expect(rowButton(PLAIN, "modal.backup.export").disabled).toBe(true);
    expect(rowButton(PIN, "action.delete").disabled).toBe(false);

    fireEvent.click(rowButton(PLAIN, "vault.export.dialog.stop"));
    expect(onStopExport).toHaveBeenCalledOnce();
  });

  it("shows the bar of several above the Saves list, under the toolbar", async () => {
    await show({ exportJob: job([PIN_KEY, PLAIN_KEY]) });

    const bar = screen.getByRole("progressbar");
    expect(follows(screen.getByLabelText("modal.backup.select_all"), bar)).toBe(true);
    expect(follows(bar, screen.getByText("modal.backup.section.saves"))).toBe(true);
    expect(within(row(PIN)).queryByRole("progressbar")).toBeNull();
    expect(screen.getByRole("button", { name: "vault.export.dialog.stop" })).toBeDefined();
  });

  it("keeps Stop usable while a delete is being confirmed", async () => {
    const onStopExport = vi.fn();
    await show({ exportJob: job([PLAIN_KEY]), onStopExport });

    fireEvent.click(rowButton(PIN, "action.delete"));
    fireEvent.click(rowButton(PLAIN, "vault.export.dialog.stop"));
    expect(onStopExport).toHaveBeenCalledOnce();
  });

  it("shows nothing for an export of another vault, and reports it as busy", async () => {
    const onExportBusy = vi.fn();
    await show({ exportJob: job([PLAIN_KEY], { vaultId: "other" }), onExportBusy });

    expect(screen.queryByRole("progressbar")).toBeNull();
    act(() => {
      fireEvent.click(rowButton(PLAIN, "modal.backup.export"));
    });
    expect(onExportBusy).toHaveBeenCalledOnce();
    expect(pickFolder).not.toHaveBeenCalled();
  });

  it("says when the stop is on its way", async () => {
    await show({ exportJob: job([PLAIN_KEY], { stopping: true }) });

    expect(rowButton(PLAIN, "vault.export.dialog.stopping").disabled).toBe(true);
  });
});
