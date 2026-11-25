/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  VaultBackupEntry,
  VaultBackupListing,
  VaultBackupSection,
  VaultListItem,
} from "@upriv/shared";
import type {
  BackupExportJob,
  PasswordChangeBackupStep,
  VaultCloseBackupWork,
} from "@upriv/shared/react";
import { useExportFolder } from "@/hooks/useExportFolder";
import { backupEntry, dataFolderListing } from "@/lib/tests/backupStubs";
import { pressStop } from "@/lib/tests/pressStop";
import { VaultBackupsModal } from "../VaultBackupsModal";

const pickFolder = vi.fn<(initial: string | null, title: string) => Promise<string | null>>();

const PIN = backupEntry("20260102000000", { saved: true, sizeBytes: 2048 });
const PLAIN = backupEntry("20260101000000", { sizeBytes: 1024 });
const PIN_KEY = PIN.key;
const PLAIN_KEY = PLAIN.key;
const BOTH = dataFolderListing([PIN, PLAIN]);

/** A section of another folder, holding `entries`. */
function folderSection(
  kind: VaultBackupSection["kind"],
  entries: VaultBackupEntry[],
  patch: Partial<VaultBackupSection> = {},
): VaultBackupSection {
  return {
    folder: "f2",
    kind,
    path: "/mnt/drive/upriv-notes-backups",
    device: { id: "b".repeat(32), system: "linux" },
    status: "ok",
    entries,
    ...patch,
  };
}

/** The data folder's section, holding `entries`. */
function dataSection(entries: VaultBackupEntry[]): VaultBackupSection {
  return dataFolderListing(entries).sections[0];
}

/** A backup in the folder `f2` on a drive. */
const ON_DRIVE = backupEntry("20260103000000", {
  key: "f2/20260103000000-notes.zip",
  sizeBytes: 4096,
  path: "/mnt/drive/upriv-notes-backups/20260103000000-notes.zip",
});

// The same service objects on every render, as the app's context gives them.
const services = vi.hoisted(() => ({
  vaultRoot: {} as { pickFolder?: unknown },
  backups: {
    listBackups: async (): Promise<unknown> => ({ sections: [] }),
    renameBackup: async (..._args: unknown[]): Promise<unknown> => null,
    forgetFolder: async (..._args: unknown[]): Promise<void> => undefined,
  },
  toast: {
    toast: null,
    dismiss: () => {},
    showError: () => {},
    errorText: () => "",
  },
}));
services.vaultRoot.pickFolder = pickFolder;
services.backups.listBackups = async () => BOTH;

/** What the window lists from now on. */
function listing(...sections: VaultBackupSection[]) {
  services.backups.listBackups = async (): Promise<VaultBackupListing> => ({ sections });
}

/** Every translation asked for with params, so a test can read what a sentence names. */
const listParams = vi.hoisted(() => [] as { key: string; params: Record<string, string> }[]);

vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (params) listParams.push({ key, params });
      return key;
    },
    locale: "en",
  }),
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
  closeBackup?: (VaultCloseBackupWork & { stoppingSince: number | null }) | null;
  onStopCloseBackup?: () => void;
  changeBackup?: PasswordChangeBackupStep | null;
  onStopChangeBackup?: () => void;
  exportJob?: BackupExportJob | null;
  onExport: (keys: readonly string[], destDir: string) => void;
  onExportBusy?: () => void;
  onStopExport?: () => void;
}

/** The window with the folder the vault list keeps. */
function Harness({
  closeBackup = null,
  onStopCloseBackup = () => {},
  changeBackup = null,
  onStopChangeBackup = () => {},
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
    saveJob: null,
    closeBackup,
    onSaveNow: () => {},
    onStopSave: () => {},
    onStopCloseBackup,
    changeBackup,
    onStopChangeBackup,
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
  await screen.findByText(PLAIN.fileName);
  return onExport;
}

function row(entry: VaultBackupEntry): HTMLElement {
  // An open ⋯ menu repeats the name in its heading, outside any row.
  const item = screen
    .getAllByText(entry.fileName)
    .map((node) => node.closest("li"))
    .find((node) => node !== null);
  if (!item) throw new Error(`no row for ${entry.stamp}`);
  return item;
}

function rowButton(entry: VaultBackupEntry, name: string): HTMLButtonElement {
  return within(row(entry)).getByRole("button", { name });
}

/** Opens the ⋯ menu of a backup's row and returns that menu. */
function rowMenu(entry: VaultBackupEntry): HTMLElement {
  const trigger = within(row(entry)).getByRole("button", { name: "action.row_options" });
  fireEvent.click(trigger);
  const menu = document.getElementById(trigger.getAttribute("aria-controls") ?? "");
  if (!menu) throw new Error(`no menu for ${entry.stamp}`);
  return menu;
}

/**
 * The item labelled `name` of a backup's ⋯ menu, opened. By text: the
 * popover stays hidden until a real layout positions it.
 */
function rowAction(entry: VaultBackupEntry, name: string): HTMLButtonElement {
  const item = within(rowMenu(entry)).getByText(name).closest("button");
  if (!(item instanceof HTMLButtonElement)) throw new Error(`no item ${name}`);
  return item;
}

function job(keys: readonly string[], overrides: Partial<BackupExportJob> = {}): BackupExportJob {
  return {
    id: "job-1",
    vaultId: "notes",
    keys,
    startedAt: Date.now(),
    progress: { bytesDone: 512, bytesTotal: 1024, stoppable: true },
    stoppingSince: null,
    ...overrides,
  };
}

/** Each section's select-all box, in page order. */
function sectionBoxes(): HTMLInputElement[] {
  return screen.getAllByLabelText<HTMLInputElement>("modal.backup.select_section");
}

function rowBox(entry: VaultBackupEntry): HTMLInputElement {
  const box = row(entry).querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!box) throw new Error(`no checkbox for ${entry.stamp}`);
  return box;
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
  services.backups.listBackups = async () => BOTH;
});

describe("VaultBackupsModal export", () => {
  it("picks a folder and exports one backup with no name step", async () => {
    pickFolder.mockResolvedValue("/media/usb");
    const onExport = await show();

    fireEvent.click(rowAction(PLAIN, "modal.backup.export"));
    await waitFor(() => expect(onExport).toHaveBeenCalledWith([PLAIN_KEY], "/media/usb"));
    expect(pickFolder).toHaveBeenCalledWith(null, "modal.backup.export_picker_title");
  });

  it("grows the row with the folder step when the pick is cancelled, so a path can be typed", async () => {
    pickFolder.mockResolvedValue(null);
    const onExport = await show();

    fireEvent.click(rowAction(PLAIN, "modal.backup.export"));
    const field = await within(row(PLAIN)).findByLabelText("modal.export_folder.label");
    await waitFor(() => expect(pickFolder).toHaveBeenCalledOnce());
    fireEvent.change(field, { target: { value: "/media/typed" } });
    fireEvent.click(rowButton(PLAIN, "modal.backup.export_confirm"));
    expect(onExport).toHaveBeenCalledWith([PLAIN_KEY], "/media/typed");
  });

  it("shows the kept folder and waits for Export, or starts from a new pick", async () => {
    pickFolder.mockResolvedValueOnce("/media/usb");
    const onExport = await show();

    fireEvent.click(rowAction(PLAIN, "modal.backup.export"));
    await waitFor(() => expect(onExport).toHaveBeenCalledOnce());

    fireEvent.click(rowAction(PIN, "modal.backup.export"));
    const field = await within(row(PIN)).findByLabelText("modal.export_folder.label");
    expect((field as HTMLInputElement).value).toBe("/media/usb");
    expect(pickFolder).toHaveBeenCalledOnce();
    expect(onExport).toHaveBeenCalledOnce();

    pickFolder.mockResolvedValueOnce("/media/other");
    fireEvent.click(rowButton(PIN, "modal.export_folder.choose"));
    await waitFor(() => expect(onExport).toHaveBeenLastCalledWith([PIN_KEY], "/media/other"));
  });

  it("puts the step for several under the list, above the selection bar", async () => {
    pickFolder.mockResolvedValue(null);
    const onExport = await show();

    for (const box of sectionBoxes()) fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "modal.backup.export_selected" }));

    const title = await screen.findByText("modal.backup.export_count");
    expect(follows(row(PLAIN), title)).toBe(true);
    expect(follows(title, screen.getByText("modal.backup.selected_count"))).toBe(true);
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
    expect(rowAction(PLAIN, "action.delete").disabled).toBe(true);
    expect(rowAction(PLAIN, "modal.backup.export").disabled).toBe(true);
    expect(rowAction(PIN, "action.delete").disabled).toBe(false);

    pressStop(rowButton(PLAIN, "modal.backup.export_stop"));
    expect(onStopExport).toHaveBeenCalledOnce();
  });

  it("shows the bar of several under the list", async () => {
    await show({ exportJob: job([PIN_KEY, PLAIN_KEY]) });

    const bar = screen.getByRole("progressbar");
    expect(follows(row(PLAIN), bar)).toBe(true);
    expect(within(row(PIN)).queryByRole("progressbar")).toBeNull();
    expect(screen.getByRole("button", { name: "modal.backup.export_stop" })).toBeDefined();
  });

  it("keeps Stop usable while a delete is being confirmed", async () => {
    const onStopExport = vi.fn();
    await show({ exportJob: job([PLAIN_KEY]), onStopExport });

    fireEvent.click(rowAction(PIN, "action.delete"));
    pressStop(rowButton(PLAIN, "modal.backup.export_stop"));
    expect(onStopExport).toHaveBeenCalledOnce();
  });

  it("shows nothing for an export of another vault, and reports it as busy", async () => {
    const onExportBusy = vi.fn();
    await show({ exportJob: job([PLAIN_KEY], { vaultId: "other" }), onExportBusy });

    expect(screen.queryByRole("progressbar")).toBeNull();
    const exportItem = rowAction(PLAIN, "modal.backup.export");
    act(() => {
      fireEvent.click(exportItem);
    });
    expect(onExportBusy).toHaveBeenCalledOnce();
    expect(pickFolder).not.toHaveBeenCalled();
  });

  it("says when the stop is on its way", async () => {
    await show({ exportJob: job([PLAIN_KEY], { stoppingSince: Date.now() }) });

    expect(rowButton(PLAIN, "modal.backup.export_stopping").disabled).toBe(true);
  });

  it("cannot stop while the file is being put in place", async () => {
    await show({
      exportJob: job([PLAIN_KEY], {
        progress: { bytesDone: 1024, bytesTotal: 1024, stoppable: false },
      }),
    });

    expect(rowButton(PLAIN, "modal.backup.export_stop").disabled).toBe(true);
  });
});

describe("VaultBackupsModal close backup", () => {
  const closeBackup = (stoppingSince: number | null, stoppable = true) => ({
    vaultId: vault.id,
    startedAt: Date.now(),
    progress: { bytesDone: 10, bytesTotal: 40, stoppable, step: null },
    stoppingSince,
  });

  it("shows the bar of the backup a close writes, with Stop in place of Back up now", async () => {
    const onStopCloseBackup = vi.fn();
    await show({ closeBackup: closeBackup(null), onStopCloseBackup });
    expect(screen.getByRole("progressbar", { name: "modal.backup.close_backup" })).toBeDefined();
    expect(screen.getByText("modal.backup.close_backup_hint")).toBeDefined();
    expect(screen.queryByRole("button", { name: "modal.backup.backup_now" })).toBeNull();

    pressStop(screen.getByRole("button", { name: "action.stop" }));
    expect(onStopCloseBackup).toHaveBeenCalledOnce();
  });

  it("says when the stop is on its way, and hides the bar meanwhile", async () => {
    await show({ closeBackup: closeBackup(Date.now()) });
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "vault.status.stopping" }).disabled,
    ).toBe(true);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("cannot stop while the zip is being put in place", async () => {
    await show({ closeBackup: closeBackup(null, false) });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "action.stop" }).disabled).toBe(
      true,
    );
  });
});

describe("VaultBackupsModal password change backup", () => {
  const changeBackup = (stoppingSince: number | null): PasswordChangeBackupStep => ({
    vaultId: vault.id,
    startedAt: Date.now(),
    progress: { bytesDone: 10, bytesTotal: 40, stoppable: true, step: "backing_up" },
    stoppingSince,
  });

  it("shows the bar of Back up first, whose Stop ends only that backup", async () => {
    const onStopChangeBackup = vi.fn();
    await show({ changeBackup: changeBackup(null), onStopChangeBackup });
    expect(screen.getByRole("progressbar", { name: "modal.backup.change_backup" })).toBeDefined();
    expect(screen.getByText("modal.backup.change_backup_hint")).toBeDefined();
    expect(screen.queryByRole("button", { name: "modal.backup.backup_now" })).toBeNull();

    pressStop(screen.getByRole("button", { name: "action.stop" }));
    expect(onStopChangeBackup).toHaveBeenCalledOnce();
  });

  it("says when that stop is on its way", async () => {
    await show({ changeBackup: changeBackup(Date.now()) });
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "vault.status.stopping" }).disabled,
    ).toBe(true);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});

describe("VaultBackupsModal sections", () => {
  it("shows no selection bar until a backup is chosen", async () => {
    await show();
    expect(screen.queryByText("modal.backup.selected_count")).toBeNull();

    fireEvent.click(rowBox(PIN));
    expect(screen.getByText("modal.backup.selected_count")).toBeDefined();
  });

  it("selects and clears only its own folder, its pins included", async () => {
    listing(dataSection([PIN, PLAIN]), folderSection("in_use", [ON_DRIVE]));
    await show();
    const [dataFolder, inUse] = sectionBoxes();

    fireEvent.click(dataFolder);
    expect(rowBox(PIN).checked).toBe(true);
    expect(rowBox(PLAIN).checked).toBe(true);
    expect(rowBox(ON_DRIVE).checked).toBe(false);
    expect(inUse.checked).toBe(false);

    fireEvent.click(inUse);
    expect(rowBox(ON_DRIVE).checked).toBe(true);

    fireEvent.click(dataFolder);
    expect(rowBox(PIN).checked).toBe(false);
    expect(rowBox(PLAIN).checked).toBe(false);
    expect(rowBox(ON_DRIVE).checked).toBe(true);
  });

  it("lists a folder's pins before its other backups, under their own heading", async () => {
    await show();
    const saves = screen.getByText("modal.backup.section.saves");
    const standard = screen.getByText("modal.backup.section.standard");
    expect(follows(saves, row(PIN))).toBe(true);
    expect(follows(row(PIN), standard)).toBe(true);
    expect(follows(standard, row(PLAIN))).toBe(true);
  });

  it("shows a folder partly chosen, and takes the rest on its box", async () => {
    listing(dataSection([PIN, PLAIN, backupEntry("20260100000000")]));
    await show();
    const [box] = sectionBoxes();
    fireEvent.click(rowBox(PLAIN));
    expect(box.indeterminate).toBe(true);

    fireEvent.click(box);
    expect(box.checked).toBe(true);
    expect(box.indeterminate).toBe(false);
  });

  it("collapses from its header, and its box never toggles it", async () => {
    await show();
    const header = screen.getByRole("button", { name: "modal.backup.group.data_folder" });
    expect(header.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(sectionBoxes()[0]);
    expect(header.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("false");
  });

  it("has no select-all for a single backup", async () => {
    listing(dataSection([PLAIN]));
    await show();
    expect(screen.queryAllByLabelText("modal.backup.select_section")).toEqual([]);
  });
});

describe("VaultBackupsModal delete", () => {
  it("names each backup it will delete in one sentence", async () => {
    await show();
    fireEvent.click(sectionBoxes()[0]);
    fireEvent.click(screen.getByRole("button", { name: "modal.backup.delete_selected" }));

    expect(listParams.some((entry) => entry.key === "modal.backup.delete_list")).toBe(true);
    const names = screen
      .getAllByText(/-notes\.zip$/)
      .filter((node) => node.tagName === "SPAN" && node.className.includes("inline-block"));
    expect(names.map((node) => node.textContent)).toEqual([PIN.fileName, PLAIN.fileName]);
    expect(names[0].parentElement?.parentElement?.textContent).toBe(
      `modal.backup.delete_list${PIN.fileName}, ${PLAIN.fileName}`,
    );
  });

  it("keeps a row to its ⋯ menu, then Save at its end, and the menu opens the folder", async () => {
    await show();
    const buttons = within(row(PLAIN)).getAllByRole("button");
    expect(
      buttons.map((button) => button.getAttribute("aria-label") ?? button.textContent),
    ).toEqual(["action.row_options", "modal.backup.promote_to_save"]);
    expect(rowAction(PLAIN, "action.open_folder").disabled).toBe(false);
  });
});

describe("VaultBackupsModal places", () => {
  it("shows a folder and a tier only when they hold backups", async () => {
    listing(dataSection([PLAIN]), folderSection("in_use", []));
    await show();

    expect(screen.getByText("modal.backup.group.data_folder")).toBeTruthy();
    expect(screen.queryByText("modal.backup.group.in_use")).toBeNull();
    expect(screen.getByText("modal.backup.section.standard")).toBeTruthy();
    expect(screen.queryByText("modal.backup.section.saves")).toBeNull();
  });

  it("puts each backup in its own folder, named in the section with its device", async () => {
    listing(dataSection([PLAIN]), folderSection("in_use", [ON_DRIVE]));
    await show();

    expect(screen.getByText("modal.backup.group.in_use")).toBeTruthy();
    expect(screen.getByText("modal.backup.group.data_folder")).toBeTruthy();
    const folder = screen.getByText("/mnt/drive/upriv-notes-backups");
    expect(follows(folder, row(ON_DRIVE))).toBe(true);
    expect(within(row(ON_DRIVE)).queryByText(ON_DRIVE.path)).toBeNull();
    expect(screen.getByText("modal.backup.folder.written_by")).toBeTruthy();
  });

  it("says Upriv no longer writes to a folder that is not in use", async () => {
    listing(dataSection([PLAIN]), folderSection("other", [ON_DRIVE]));
    await show();

    expect(screen.getByText("modal.backup.group.other")).toBeTruthy();
    expect(screen.getByText("modal.backup.folder.not_in_use")).toBeTruthy();
  });

  it("keeps Back up now and says so when there are no backups", async () => {
    listing(dataSection([]));
    render(createElement(Harness, { onExport: () => {} }));

    expect(await screen.findByText("modal.backup.empty")).toBeTruthy();
    expect(screen.getByRole("button", { name: "modal.backup.backup_now" })).toBeTruthy();
    expect(screen.queryByText("modal.backup.group.data_folder")).toBeNull();
  });

  it("shows a folder that cannot be reached with Retry and Forget", async () => {
    const forgetFolder = vi.fn(async () => undefined);
    services.backups.forgetFolder = forgetFolder;
    listing(
      dataSection([PLAIN]),
      folderSection("other", [], { path: "/mnt/gone/upriv-notes-backups", status: "missing" }),
    );
    await show();

    expect(screen.getByText("folder_list.status.missing")).toBeTruthy();
    expect(screen.getByText("/mnt/gone/upriv-notes-backups")).toBeTruthy();
    expect(screen.getByRole("button", { name: "action.retry" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "modal.backup.folder.forget" }));
    await waitFor(() => expect(forgetFolder).toHaveBeenCalledWith("notes", "f2"));
  });

  it("says nothing about a folder that works", async () => {
    listing(dataSection([PLAIN]), folderSection("in_use", [ON_DRIVE]));
    await show();

    expect(screen.queryByRole("button", { name: "action.retry" })).toBeNull();
  });

  it("offers no Open folder for a backup whose folder does not answer", async () => {
    listing(dataSection([PLAIN]), folderSection("other", [ON_DRIVE], { status: "missing" }));
    await show();

    expect(within(rowMenu(ON_DRIVE)).queryByText("action.open_folder")).toBeNull();
    expect(within(rowMenu(PLAIN)).queryByText("action.open_folder")).not.toBeNull();
  });
});

describe("VaultBackupsModal rename", () => {
  it("names a backup from its row", async () => {
    const renameBackup = vi.fn(async () => PLAIN);
    services.backups.renameBackup = renameBackup;
    await show();

    fireEvent.click(rowAction(PLAIN, "modal.backup.rename"));
    const field = within(row(PLAIN)).getByLabelText("modal.backup.rename_label");
    fireEvent.change(field, { target: { value: "  Trip  " } });
    fireEvent.click(rowButton(PLAIN, "modal.backup.rename_save"));
    await waitFor(() => expect(renameBackup).toHaveBeenCalledWith("notes", PLAIN_KEY, "Trip"));
  });

  it("holds a name longer than a backup may have", async () => {
    await show();

    fireEvent.click(rowAction(PLAIN, "modal.backup.rename"));
    fireEvent.change(within(row(PLAIN)).getByLabelText("modal.backup.rename_label"), {
      target: { value: "x".repeat(81) },
    });
    expect(rowButton(PLAIN, "modal.backup.rename_save").disabled).toBe(true);
  });
});
