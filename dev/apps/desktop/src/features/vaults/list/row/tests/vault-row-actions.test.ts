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
  const onCloseNow = vi.fn();
  const actions = createElement(VaultRowActions, {
    vault,
    pipelineListStatus,
    onOpenBackups: () => {},
    onOpenNote: () => {},
    onOpenVaultInfo: () => {},
    onOpenSettings: () => {},
    onExportVault: () => {},
    onOpenFileManager: () => {},
    onCloseNow,
  });
  render(strict ? createElement(StrictMode, null, actions) : actions);
  return onCloseNow;
}

function moreButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "app.menu.more" }) as HTMLButtonElement;
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
    const onCloseNow = show(OPEN, { closingVaultIds: ["notes"] });
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
