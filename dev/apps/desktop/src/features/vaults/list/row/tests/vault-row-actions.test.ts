/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, createElement } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultAppSettings,
  type OsFolderAnswer,
  type VaultListItem,
  type VaultPipelineListStatus,
} from "@upriv/shared";
import { VaultRowActions } from "../VaultRowActions";

/** The vault has no unlocked folder unless a test says otherwise. */
const NO_FOLDER: OsFolderAnswer = { state: "none" };
const READY: OsFolderAnswer = { state: "ready", osPath: "/mnt/upriv-unlocked/Notes" };
const fileSystem = vi.hoisted(() => ({
  osPath: vi.fn<() => Promise<OsFolderAnswer>>(),
}));
const rpc = vi.hoisted(() => ({ rpcRevealOsPath: vi.fn(async () => undefined) }));

vi.mock("@/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("@/features/system/settings", () => ({
  useAppSettingsContext: () => ({ settings: createDefaultAppSettings() }),
}));
vi.mock("@/platform/services", () => ({
  useVaultService: () => ({ canExportVault: false }),
  useVaultFileSystemService: () => fileSystem,
}));
vi.mock("@/lib/rpc", () => rpc);
vi.mock("@/lib/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/invoke")>()),
  isElectronRenderer: () => true,
}));

const OPEN = {
  id: "notes",
  displayName: "Notes",
  storageMode: "encrypted_dir",
  session: "open",
} as VaultListItem;
const CLOSED = { ...OPEN, session: null } as VaultListItem;

/** The row's actions; `strict` mounts them the way the app's development build does. */
function show(
  vault: VaultListItem,
  pipelineListStatus: VaultPipelineListStatus = {},
  strict = false,
) {
  const handlers = {
    onCloseNow: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenDelete: vi.fn(),
    onDeleteWork: vi.fn(),
  };
  const actions = createElement(VaultRowActions, {
    vault,
    pipelineListStatus,
    onOpenBackups: () => {},
    onOpenNote: () => {},
    onOpenVaultInfo: () => {},
    onExportVault: () => {},
    onOpenFileManager: () => {},
    ...handlers,
  });
  render(strict ? createElement(StrictMode, null, actions) : actions);
  return handlers;
}

function moreButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "app.menu.more" }) as HTMLButtonElement;
}

function settingsButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "action.settings" }) as HTMLButtonElement;
}

/** By text: the popover stays hidden until a real layout positions it, and hides names too. */
function menuItem(label: string): HTMLButtonElement | null {
  return screen.queryByText(label)?.closest("button") ?? null;
}

/** A menu item that shows once an answer lands. */
function itemShown(label: string): Promise<HTMLButtonElement> {
  return waitFor(() => {
    const item = menuItem(label);
    expect(item).not.toBeNull();
    return item!;
  });
}

function closeNowItem(): HTMLButtonElement | null {
  return menuItem("action.close_now");
}

beforeAll(() => {
  window.requestAnimationFrame = (run) => {
    run(0);
    return 0;
  };
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});
beforeEach(() => {
  fileSystem.osPath.mockReset();
  fileSystem.osPath.mockResolvedValue(NO_FOLDER);
});
afterEach(cleanup);

describe("Open unlocked folder in More options", () => {
  it("reveals the vault's folder, also in a Strict Mode build", async () => {
    fileSystem.osPath.mockResolvedValue(READY);
    show(OPEN, {}, true);
    fireEvent.click(moreButton());
    fireEvent.click(await itemShown("action.open_unlocked_folder"));
    await waitFor(() =>
      expect(rpc.rpcRevealOsPath).toHaveBeenCalledWith("/mnt/upriv-unlocked/Notes"),
    );
  });

  it("is not offered while the vault has no folder, and nothing is said", async () => {
    show(OPEN);
    fireEvent.click(moreButton());
    await waitFor(() => expect(fileSystem.osPath).toHaveBeenCalled());
    expect(menuItem("action.open_unlocked_folder")).toBeNull();
    expect(screen.queryByText(/unlocked_folder/)).toBeNull();
  });

  it("shows up once the folder is there, asked again when the menu opens", async () => {
    show(OPEN);
    await waitFor(() => expect(fileSystem.osPath).toHaveBeenCalled());
    fileSystem.osPath.mockResolvedValue(READY);
    fireEvent.click(moreButton());
    await itemShown("action.open_unlocked_folder");
  });

  it("is not offered on a closed vault, and asks nothing", () => {
    show(CLOSED);
    fireEvent.click(moreButton());
    expect(menuItem("action.open_unlocked_folder")).toBeNull();
    expect(fileSystem.osPath).not.toHaveBeenCalled();
  });
});

describe("Close now in More options", () => {
  it("is there while the vault is open", () => {
    show(OPEN);
    fireEvent.click(moreButton());
    expect(closeNowItem()).not.toBeNull();
  });

  it("is there during a running close, and runs from there", () => {
    const { onCloseNow } = show(OPEN, { closingVaultIds: ["notes"] });
    fireEvent.click(moreButton());
    fireEvent.click(closeNowItem()!);
    expect(onCloseNow).toHaveBeenCalledWith(OPEN);
  });

  it("opens the menu for a close waiting in the queue", () => {
    show(OPEN, { queuedVaultIds: ["notes"], queuedOpenVaultIds: [] });
    expect(moreButton().disabled).toBe(false);
    fireEvent.click(moreButton());
    expect(closeNowItem()?.disabled).toBe(false);
    expect(menuItem("action.backups")?.disabled).toBe(true);
  });

  it("leaves the menu shut for an open waiting in the queue", () => {
    show(CLOSED, { queuedVaultIds: ["notes"], queuedOpenVaultIds: ["notes"] });
    expect(moreButton().disabled).toBe(true);
  });

  it("goes once it was asked for", () => {
    show(OPEN, { closingVaultIds: ["notes"], closeNowVaultIds: ["notes"] });
    fireEvent.click(moreButton());
    expect(menuItem("action.backups")).not.toBeNull();
    expect(closeNowItem()).toBeNull();
  });

  it("is not there on a closed vault", () => {
    show(CLOSED);
    fireEvent.click(moreButton());
    expect(menuItem("action.backups")).not.toBeNull();
    expect(closeNowItem()).toBeNull();
  });
});

describe("Delete vault in the Settings menu", () => {
  it("comes after the settings screens and opens its own window", () => {
    const { onOpenDelete, onOpenSettings } = show(CLOSED);
    fireEvent.click(settingsButton());
    const labels = screen
      .getAllByRole("menuitem", { hidden: true })
      .map((item) => item.textContent);
    expect(labels).toEqual([
      "modal.settings.area.preferences",
      "modal.settings.area.password",
      "modal.settings.area.kdf",
      "modal.settings.area.storage",
      "modal.settings.area.group",
      "modal.delete_vault.title",
    ]);
    fireEvent.click(menuItem("modal.delete_vault.title")!);
    expect(onOpenDelete).toHaveBeenCalledWith("notes");
    expect(onOpenSettings).not.toHaveBeenCalled();
  });

  it("is not there while the vault is open", () => {
    show(OPEN);
    fireEvent.click(settingsButton());
    expect(menuItem("modal.settings.area.preferences")).not.toBeNull();
    expect(menuItem("modal.delete_vault.title")).toBeNull();
  });

  it("opens a settings screen from the other entries", () => {
    const { onOpenDelete, onOpenSettings } = show(CLOSED);
    fireEvent.click(settingsButton());
    fireEvent.click(menuItem("modal.settings.area.preferences")!);
    expect(onOpenSettings).toHaveBeenCalledWith("notes", "preferences");
    expect(onOpenDelete).not.toHaveBeenCalled();
  });

  it("is the only entry while the vault is being deleted", () => {
    show(CLOSED, { deletingVaultIds: ["notes"] });
    expect(settingsButton().disabled).toBe(false);
    fireEvent.click(settingsButton());
    expect(menuItem("modal.delete_vault.title")).not.toBeNull();
    expect(menuItem("modal.settings.area.preferences")).toBeNull();
  });
});

describe("Delete now in More options", () => {
  it("is there while a delete runs, and asks for Delete now", () => {
    const { onDeleteWork } = show(CLOSED, { deletingVaultIds: ["notes"] });
    fireEvent.click(moreButton());
    fireEvent.click(menuItem("action.delete_now")!);
    expect(onDeleteWork).toHaveBeenCalledWith(CLOSED, true);
  });

  it("goes once it was asked for, and is never there otherwise", () => {
    show(CLOSED, { deletingVaultIds: ["notes"], deleteNowVaultIds: ["notes"] });
    fireEvent.click(moreButton());
    expect(menuItem("action.delete_now")).toBeNull();
    cleanup();
    show(CLOSED);
    fireEvent.click(moreButton());
    expect(menuItem("action.delete_now")).toBeNull();
  });
});
