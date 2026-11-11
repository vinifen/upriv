/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  VAULT_ROOT_PATH_CHECK_DELAY_MS,
  type BackupFolderStatus,
  type VaultBackupPlace,
} from "@upriv/shared";
import { BackupFolderChoices, VaultSettingsDangerZoneSection } from "../vaultSettingsForm";

const services = vi.hoisted(() => ({
  checkFolder: vi.fn<(path: string, vault: string | null) => Promise<BackupFolderStatus>>(),
  pickFolder: vi.fn<(initial: string | null, title: string) => Promise<string | null>>(),
}));

vi.mock("@/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("@/hooks/useRevealWhen", () => ({ useRevealWhen: () => undefined }));
vi.mock("@/platform/services", () => {
  const backup = { checkFolder: services.checkFolder };
  const root = { pickFolder: services.pickFolder };
  return { useBackupService: () => backup, useVaultRootService: () => root };
});

const PLACEHOLDER = "modal.folder_field.placeholder";

function radio(value: string): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`);
  if (!input) throw new Error(`no ${value} radio`);
  return input;
}

function needsStep(value: string): boolean {
  return radio(value).closest("label")?.className.includes("vault-status-recovery") ?? false;
}

function Choices({
  savedPlace,
  savedPath,
  onBlocking,
}: {
  savedPlace: VaultBackupPlace;
  savedPath: string;
  onBlocking: (blocking: boolean) => void;
}) {
  const [row, setRow] = useState({ place: savedPlace, path: savedPath });
  return createElement(BackupFolderChoices, {
    groupLabel: "Where backups go",
    active: true,
    place: row.place,
    path: row.path,
    inheritDescription: "follows the app",
    dataFolderTitle: "Data folder",
    dataFolderDescription: "inside .upriv",
    customTitle: "Another folder",
    customDescription: "somewhere else",
    vaultId: "notes",
    vaultRootPath: "/data",
    savedPlace,
    savedPath,
    onChange: (place, path) => setRow({ place, path }),
    onBlockingChange: onBlocking,
  });
}

function show(savedPlace: VaultBackupPlace, savedPath = "") {
  const onBlocking = vi.fn<(blocking: boolean) => void>();
  render(createElement(Choices, { savedPlace, savedPath, onBlocking }));
  return onBlocking;
}

function field(): HTMLInputElement {
  return screen.getByPlaceholderText<HTMLInputElement>(PLACEHOLDER);
}

async function passCheckDelay() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(VAULT_ROOT_PATH_CHECK_DELAY_MS);
  });
}

describe("BackupFolderChoices", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    services.checkFolder.mockReset().mockResolvedValue("ok");
    services.pickFolder.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("chooses Another folder without opening the picker, and holds Save until it has a path", () => {
    const onBlocking = show("inherit");
    expect(onBlocking).toHaveBeenLastCalledWith(false);

    fireEvent.click(radio("custom"));

    expect(services.pickFolder).not.toHaveBeenCalled();
    expect(radio("custom").checked).toBe(true);
    expect(needsStep("custom")).toBe(true);
    expect(onBlocking).toHaveBeenLastCalledWith(true);
  });

  it("holds Save while a typed folder is checked, and lets go once it works", async () => {
    const onBlocking = show("inherit");
    fireEvent.click(radio("custom"));
    fireEvent.change(field(), { target: { value: "/mnt/usb" } });

    expect(onBlocking).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole("status").textContent).toBe("modal.backup.folder.checking");

    await passCheckDelay();

    expect(services.checkFolder).toHaveBeenLastCalledWith("/mnt/usb", "notes");
    expect(onBlocking).toHaveBeenLastCalledWith(false);
    expect(needsStep("custom")).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("holds Save for a typed folder that fails, says why, and checks again on Retry", async () => {
    services.checkFolder.mockResolvedValueOnce("no_permission");
    const onBlocking = show("inherit");
    fireEvent.click(radio("custom"));
    fireEvent.change(field(), { target: { value: "/mnt/usb" } });
    await passCheckDelay();

    expect(screen.getByRole("alert").textContent).toBe("modal.backup.folder.status.no_permission");
    expect(needsStep("custom")).toBe(true);
    expect(onBlocking).toHaveBeenLastCalledWith(true);

    fireEvent.click(screen.getByRole("button", { name: "action.retry" }));
    await passCheckDelay();

    expect(services.checkFolder).toHaveBeenCalledTimes(2);
    expect(onBlocking).toHaveBeenLastCalledWith(false);
  });

  it("marks the folder already saved when it fails and never holds Save for it", async () => {
    services.checkFolder.mockResolvedValue("missing");
    const onBlocking = show("custom", "/mnt/usb");
    await passCheckDelay();

    expect(screen.getByRole("alert").textContent).toBe("modal.backup.folder.status.missing");
    expect(field().value).toBe("/mnt/usb");
    expect(radio("custom").checked).toBe(true);
    expect(onBlocking).toHaveBeenLastCalledWith(false);
  });

  it("holds Save for a folder inside the data folder, with no check on disk", async () => {
    const onBlocking = show("inherit");
    fireEvent.click(radio("custom"));
    fireEvent.change(field(), { target: { value: "/data/.upriv/backups" } });
    await passCheckDelay();

    expect(services.checkFolder).not.toHaveBeenCalled();
    expect(onBlocking).toHaveBeenLastCalledWith(true);
  });

  it("keeps the path when another option is chosen, and has it back", () => {
    show("custom", "/mnt/usb");

    fireEvent.click(radio("data_folder"));
    expect(field().value).toBe("/mnt/usb");
    expect(field().disabled).toBe(true);

    fireEvent.click(radio("custom"));
    expect(field().value).toBe("/mnt/usb");
    expect(field().disabled).toBe(false);
  });

  it("checks nothing while the folder is not the one in use", async () => {
    show("data_folder", "/mnt/usb");
    await passCheckDelay();
    expect(services.checkFolder).not.toHaveBeenCalled();
  });
});

describe("VaultSettingsDangerZoneSection outside backups", () => {
  const SWITCH = "modal.settings.delete_outside_backups";
  afterEach(cleanup);

  function showZone(outsideBackups: boolean, removeOutsideBackups = false) {
    const onRemove = vi.fn<(remove: boolean) => void>();
    render(
      createElement(VaultSettingsDangerZoneSection, {
        vaultId: "notes",
        deleteOpen: true,
        deleteConfirm: "",
        confirmInputId: "confirm",
        canConfirmDelete: false,
        outsideBackups,
        removeOutsideBackups,
        onRemoveOutsideBackupsChange: onRemove,
        onRequestDelete: () => undefined,
        onCancelDelete: () => undefined,
        onConfirmDelete: () => undefined,
        onConfirmChange: () => undefined,
      }),
    );
    return onRemove;
  }

  it("has no switch for a vault with no backups outside", () => {
    showZone(false);
    expect(screen.queryByLabelText(SWITCH)).toBeNull();
  });

  it("starts off, and asks for the change", () => {
    const onRemove = showZone(true);
    const control = screen.getByLabelText(SWITCH);
    expect(control.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(control);
    expect(onRemove).toHaveBeenCalledWith(true);
  });
});
