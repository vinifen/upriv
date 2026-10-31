/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createDefaultAppSettings,
  type VaultListItem,
  type VaultPipelineListStatus,
} from "@upriv/shared";
import { VaultRowActions } from "../VaultRowActions";

vi.mock("@/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("@/features/system/settings", () => ({
  useAppSettingsContext: () => ({ settings: createDefaultAppSettings() }),
}));
vi.mock("@/platform/services", () => ({
  useVaultService: () => ({ canExportVault: false, getSettings: async () => null }),
}));
vi.mock("@/lib/rpc", () => ({ rpcRevealInFileManager: vi.fn() }));

const OPEN = {
  id: "notes",
  displayName: "Notes",
  storageMode: "encrypted_dir",
  session: "open",
} as VaultListItem;
const CLOSED = { ...OPEN, session: null } as VaultListItem;

function show(vault: VaultListItem, pipelineListStatus: VaultPipelineListStatus = {}) {
  const onCloseNow = vi.fn();
  render(
    createElement(VaultRowActions, {
      vault,
      pipelineListStatus,
      onOpenBackups: () => {},
      onOpenNote: () => {},
      onOpenVaultInfo: () => {},
      onOpenSettings: () => {},
      onExportVault: () => {},
      onOpenFileManager: () => {},
      onCloseNow,
    }),
  );
  return onCloseNow;
}

function moreButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "app.menu.more" }) as HTMLButtonElement;
}

/** By text: the popover stays hidden until a real layout positions it, and hides names too. */
function menuItem(label: string): HTMLButtonElement | null {
  return screen.queryByText(label)?.closest("button") ?? null;
}

function closeNowItem(): HTMLButtonElement | null {
  return menuItem("action.close_now");
}

describe("Close now in More options", () => {
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
  afterEach(cleanup);

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
