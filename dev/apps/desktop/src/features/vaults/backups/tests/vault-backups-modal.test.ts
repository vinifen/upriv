/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { VaultBackupEntry, VaultListItem } from "@upriv/shared";
import type { BackupExportJob } from "@upriv/shared/react";
import { useExportFolder } from "@/hooks/useExportFolder";
import { pressStop } from "@/lib/tests/pressStop";
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
  backups: {
    listBackups: async (): Promise<{ backups: unknown[]; chosen: unknown }> => ({
      backups: [],
      chosen: null,
    }),
  },
  toast: {
    toast: null,
    dismiss: () => {},
    showError: () => {},
    errorText: () => "",
  },
}));
services.vaultRoot.pickFolder = pickFolder;
services.backups.listBackups = async () => ({ backups: [PIN, PLAIN], chosen: null });

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
    saveJob: null,
    onSaveNow: () => {},
    onStopSave: () => {},
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
    fireEvent.click(rowButton(PLAIN, "modal.backup.export_confirm"));
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
    expect(rowButton(PLAIN, "action.delete").disabled).toBe(true);
    expect(rowButton(PLAIN, "modal.backup.export").disabled).toBe(true);
    expect(rowButton(PIN, "action.delete").disabled).toBe(false);

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

    fireEvent.click(rowButton(PIN, "action.delete"));
    pressStop(rowButton(PLAIN, "modal.backup.export_stop"));
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

describe("VaultBackupsModal sections", () => {
  it("shows no selection bar until a backup is chosen", async () => {
    await show();
    expect(screen.queryByText("modal.backup.selected_count")).toBeNull();

    fireEvent.click(rowBox(PIN));
    expect(screen.getByText("modal.backup.selected_count")).toBeDefined();
  });

  it("selects and clears only its own folder, its pins included", async () => {
    const onDrive: VaultBackupEntry = {
      ...PLAIN,
      stamp: "20260103000000",
      fileName: "20260103000000-notes.zip",
      location: "chosen",
      path: "/mnt/drive/upriv-notes-backups/20260103000000-notes.zip",
    };
    services.backups.listBackups = async () => ({ backups: [PIN, PLAIN, onDrive], chosen: null });
    try {
      await show();
      const [dataFolder, chosen] = sectionBoxes();

      fireEvent.click(dataFolder);
      expect(rowBox(PIN).checked).toBe(true);
      expect(rowBox(PLAIN).checked).toBe(true);
      expect(rowBox(onDrive).checked).toBe(false);
      expect(chosen.checked).toBe(false);

      fireEvent.click(chosen);
      expect(rowBox(onDrive).checked).toBe(true);

      fireEvent.click(dataFolder);
      expect(rowBox(PIN).checked).toBe(false);
      expect(rowBox(PLAIN).checked).toBe(false);
      expect(rowBox(onDrive).checked).toBe(true);
    } finally {
      services.backups.listBackups = async () => ({ backups: [PIN, PLAIN], chosen: null });
    }
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
    services.backups.listBackups = async () => ({
      backups: [
        PIN,
        PLAIN,
        { ...PLAIN, stamp: "20260100000000", fileName: "20260100000000-notes.zip" },
      ],
      chosen: null,
    });
    try {
      await show();
      const [box] = sectionBoxes();
      fireEvent.click(rowBox(PLAIN));
      expect(box.indeterminate).toBe(true);

      fireEvent.click(box);
      expect(box.checked).toBe(true);
      expect(box.indeterminate).toBe(false);
    } finally {
      services.backups.listBackups = async () => ({ backups: [PIN, PLAIN], chosen: null });
    }
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
    services.backups.listBackups = async () => ({ backups: [PLAIN], chosen: null });
    try {
      await show();
      expect(screen.queryAllByLabelText("modal.backup.select_section")).toEqual([]);
    } finally {
      services.backups.listBackups = async () => ({ backups: [PIN, PLAIN], chosen: null });
    }
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

  it("gives a row no button to open its folder", async () => {
    await show();
    expect(
      within(row(PLAIN)).queryByRole("button", { name: "modal.file_manager.context.open_system" }),
    ).toBeNull();
  });
});

describe("VaultBackupsModal places", () => {
  const ON_DRIVE: VaultBackupEntry = {
    stamp: "20260103000000",
    fileName: "20260103000000-notes.zip",
    createdAt: "2026-01-03T00:00:00.000Z",
    sizeBytes: 4096,
    location: "chosen",
    path: "/mnt/drive/upriv-notes-backups/20260103000000-notes.zip",
  };
  const original = services.backups.listBackups;

  afterEach(() => {
    services.backups.listBackups = original;
  });

  function listing(backups: VaultBackupEntry[], chosen: unknown = null) {
    services.backups.listBackups = async () => ({ backups, chosen });
  }

  it("shows a folder and a tier only when they hold backups", async () => {
    listing([PLAIN]);
    await show();

    expect(screen.getByText("modal.backup.group.data_folder")).toBeTruthy();
    expect(screen.queryByText("modal.backup.group.chosen")).toBeNull();
    expect(screen.getByText("modal.backup.section.standard")).toBeTruthy();
    expect(screen.queryByText("modal.backup.section.saves")).toBeNull();
  });

  it("puts each backup in its own place, with that folder in the section", async () => {
    listing([ON_DRIVE, PLAIN]);
    await show();

    expect(screen.getByText("modal.backup.group.chosen")).toBeTruthy();
    expect(screen.getByText("modal.backup.group.data_folder")).toBeTruthy();
    const folder = screen.getByText("/mnt/drive/upriv-notes-backups");
    expect(follows(folder, row(ON_DRIVE))).toBe(true);
    expect(within(row(ON_DRIVE)).queryByText(ON_DRIVE.path ?? "")).toBeNull();
  });

  it("keeps Back up now and says so when there are no backups", async () => {
    listing([]);
    render(createElement(Harness, { onExport: () => {} }));

    expect(await screen.findByText("modal.backup.empty")).toBeTruthy();
    expect(screen.getByRole("button", { name: "modal.backup.backup_now" })).toBeTruthy();
    expect(screen.queryByText("modal.backup.group.data_folder")).toBeNull();
  });

  it("names a folder that fails on one line, with no section for it", async () => {
    listing([PLAIN], { path: "/mnt/gone/upriv-notes-backups", status: "missing" });
    await show();

    expect(screen.getByText("modal.backup.folder.status.missing")).toBeTruthy();
    expect(screen.getByText("/mnt/gone/upriv-notes-backups")).toBeTruthy();
    expect(screen.getByRole("button", { name: "modal.backup.folder.reuse" })).toBeTruthy();
    expect(screen.queryByText("modal.backup.group.chosen")).toBeNull();
  });

  it("says nothing about a folder that works", async () => {
    listing([ON_DRIVE, PLAIN], { path: "/mnt/drive/upriv-notes-backups", status: "ok" });
    await show();

    expect(screen.queryByRole("button", { name: "action.retry" })).toBeNull();
  });
});
