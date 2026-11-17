/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RpcError,
  VAULT_ROOT_ERROR_CODES,
  createDefaultAppSettings,
  type FolderSwitch,
  type VaultRootResolveResult,
} from "@upriv/shared";
import type { SetupScreen } from "../VaultRootSetupModal";
import { VaultRootGate } from "../VaultRootGate";

const resolve = vi.fn<() => Promise<VaultRootResolveResult>>();
let vaultRootEpoch = 0;

vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      params?.names ? `${key} ${params.names}` : key,
  }),
}));

vi.mock("../AppSettingsContext", () => ({
  useAppSettingsContext: () => ({
    settings: createDefaultAppSettings(),
    settingsReady: true,
    settingsLoadFailed: false,
    get vaultRootEpoch() {
      return vaultRootEpoch;
    },
    reloadSettings: async () => {},
  }),
}));

vi.mock("@/platform/services", () => ({
  useVaultRootService: () => ({ resolve }),
}));

/**
 * Setup as a button that says which screen it shows; a click lands a data
 * folder with `change`, naming the vaults the resolve said ended.
 */
let change: FolderSwitch | null = null;
vi.mock("../VaultRootSetupModal", () => ({
  VaultRootSetupModal: (props: {
    open: boolean;
    screen: SetupScreen | null;
    ended: readonly string[];
    onConfigured: (change: FolderSwitch | null, ended: readonly string[]) => void;
  }) =>
    props.open && props.screen
      ? createElement(
          "button",
          { onClick: () => props.onConfigured(change, props.ended) },
          props.screen.kind,
        )
      : null,
}));

const firstRun: VaultRootResolveResult = {
  status: "needs_setup",
  defaultRootAnchor: "/app",
  distribution: "dev",
  ended: [],
};

const usbFailed: VaultRootResolveResult = {
  status: "selected_failed",
  choice: { kind: "row", number: 2, name: "USB" },
  reason: "missing",
  ended: [],
};

const found: VaultRootResolveResult = { status: "found", rootPath: "/home/Music", source: "row" };

afterEach(() => {
  cleanup();
  resolve.mockReset();
  vaultRootEpoch = 0;
  change = null;
});

describe("VaultRootGate", () => {
  it("shows the first run, and resolves again once Setup applies", async () => {
    resolve.mockResolvedValue(firstRun);
    render(createElement(VaultRootGate, null, createElement("main")));
    const setup = await screen.findByText("first_run");

    resolve.mockResolvedValue(found);
    const before = resolve.mock.calls.length;
    await act(async () => setup.click());
    expect(resolve.mock.calls.length).toBeGreaterThan(before);
    expect(screen.queryByText("first_run")).toBeNull();
  });

  it("shows the list with the search when the selected choice did not answer", async () => {
    resolve.mockResolvedValue(usbFailed);
    render(createElement(VaultRootGate, null, createElement("main")));
    expect(await screen.findByText("selected_failed")).toBeDefined();
  });

  it("toasts the switch a search made", async () => {
    resolve.mockResolvedValue(usbFailed);
    render(createElement(VaultRootGate, null, createElement("main")));
    const setup = await screen.findByText("selected_failed");
    change = {
      list: "data_folder",
      level: "app",
      from: { kind: "row", number: 2, name: "USB" },
      to: { kind: "fixed", choice: "default" },
      reason: "missing",
      saved: true,
    };
    resolve.mockResolvedValue(found);
    await act(async () => setup.click());
    expect(screen.getByText("folder_list.switch.data_folder_app")).toBeDefined();
  });

  it("repairs a broken data folder and reads an unreadable list on their own screens", async () => {
    resolve.mockRejectedValue(new RpcError(VAULT_ROOT_ERROR_CODES.INCOMPLETE, "broken"));
    render(createElement(VaultRootGate, null, createElement("main")));
    expect(await screen.findByText("repair")).toBeDefined();
    cleanup();

    resolve.mockRejectedValue(new RpcError(VAULT_ROOT_ERROR_CODES.LIST_INVALID, "unreadable"));
    render(createElement(VaultRootGate, null, createElement("main")));
    expect(await screen.findByText("list_invalid")).toBeDefined();
  });

  it("searches again when the data folder goes while Upriv runs, and names the vaults it closed", async () => {
    resolve.mockResolvedValue(found);
    const { rerender } = render(
      createElement(VaultRootGate, null, createElement("main", null, "app-content")),
    );
    expect(await screen.findByText("app-content")).toBeDefined();

    // The selection stays: the next resolve finds it failing, as at launch,
    // and names the vault that ended with it.
    resolve.mockResolvedValue({ ...usbFailed, ended: ["Notes"] });
    vaultRootEpoch = 1;
    await act(async () => {
      rerender(createElement(VaultRootGate, null, createElement("main", null, "app-content")));
    });
    const setup = await screen.findByText("selected_failed");
    const main = screen.getByText("app-content");
    expect(main.parentElement?.getAttribute("aria-hidden")).toBe("true");

    resolve.mockResolvedValue(found);
    await act(async () => setup.click());
    expect(screen.getByText("modal.vault_root_setup.sessions_ended Notes")).toBeDefined();
  });
});
