/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultAppSettings,
  type AppSettingsConfig,
  type VaultRootResolveResult,
} from "@upriv/shared";
import { VaultRootGate } from "../VaultRootGate";

let snapshot: AppSettingsConfig = createDefaultAppSettings();
const rendered = createDefaultAppSettings();
const resolve = vi.fn<(options: { vaultRootMode: string }) => Promise<VaultRootResolveResult>>();
const defaultRootStatus = vi.fn<() => Promise<{ status: string; defaultRootAnchor: string }>>();
let vaultRootEpoch = 0;

vi.mock("@/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

vi.mock("../AppSettingsContext", () => ({
  useAppSettingsContext: () => ({
    settings: rendered,
    settingsReady: true,
    settingsLoadFailed: false,
    get vaultRootEpoch() {
      return vaultRootEpoch;
    },
    reloadSettings: async () => {},
    getSettingsSnapshot: () => snapshot,
  }),
}));

vi.mock("@/platform/services", () => ({
  useVaultRootService: () => ({
    resolve,
    defaultRootStatus,
    readAlias: async () => null,
    inspectAtPath: async (path: string) => ({ status: "missing", path }),
  }),
}));

vi.mock("../VaultRootSetupModal", () => ({
  VaultRootSetupModal: (props: { open: boolean; onConfigured: () => void }) =>
    props.open ? createElement("button", { onClick: props.onConfigured }, "configured") : null,
}));
vi.mock("../VaultRootRepairModal", () => ({ VaultRootRepairModal: () => null }));
vi.mock("../VaultRootAliasRecoveryModal", () => ({ VaultRootAliasRecoveryModal: () => null }));

const needsSetup: VaultRootResolveResult = {
  status: "needs_setup",
  defaultRootAnchor: "/app",
  aliasPath: "/app/.upriv-data-folder",
  distribution: "dev",
};

afterEach(() => {
  cleanup();
  resolve.mockReset();
  defaultRootStatus.mockReset();
  snapshot = createDefaultAppSettings();
  vaultRootEpoch = 0;
});

describe("VaultRootGate", () => {
  it("resolves a custom folder from Setup with the settings it just loaded", async () => {
    resolve.mockResolvedValue(needsSetup);
    defaultRootStatus.mockResolvedValue({ status: "missing", defaultRootAnchor: "/app" });
    render(createElement(VaultRootGate, null, createElement("main")));
    const configured = await screen.findByText("configured");
    expect(resolve).toHaveBeenLastCalledWith(
      expect.objectContaining({ vaultRootMode: "default_root" }),
    );

    // Setup reloaded the new folder's settings into the context; the Gate has
    // not re-rendered with them yet when Setup calls back.
    snapshot = {
      ...snapshot,
      app: { ...snapshot.app, vault_root_mode: "custom_root", upriv_root_path: "/home/Music" },
    };
    resolve.mockResolvedValue({ status: "found", rootPath: "/home/Music", source: "custom_root" });
    const before = resolve.mock.calls.length;
    await act(async () => configured.click());

    const after = resolve.mock.calls.slice(before).map(([options]) => options.vaultRootMode);
    expect(after).not.toHaveLength(0);
    expect(after.every((mode) => mode === "custom_root")).toBe(true);
    expect(screen.queryByText("configured")).toBeNull();
  });

  it("re-resolves and presents Setup modal when vaultRootEpoch bumps after .upriv is deleted", async () => {
    resolve.mockResolvedValue({ status: "found", rootPath: "/home/Music", source: "custom_root" });
    snapshot = {
      ...snapshot,
      app: { ...snapshot.app, vault_root_mode: "custom_root", upriv_root_path: "/home/Music" },
    };

    const { rerender } = render(
      createElement(VaultRootGate, null, createElement("main", null, "app-content")),
    );
    expect(await screen.findByText("app-content")).toBeDefined();

    // Now .upriv was deleted; an operation or refresh reported integrity failure, bumping vaultRootEpoch.
    resolve.mockResolvedValue(needsSetup);
    defaultRootStatus.mockResolvedValue({ status: "missing", defaultRootAnchor: "/app" });
    vaultRootEpoch = 1;

    await act(async () => {
      rerender(createElement(VaultRootGate, null, createElement("main", null, "app-content")));
    });

    const configured = await screen.findByText("configured");
    expect(configured).toBeDefined();
    const main = screen.getByText("app-content");
    expect(main.parentElement?.getAttribute("aria-hidden")).toBe("true");
  });

  it("presents Setup modal in custom_root mode even when default root is valid", async () => {
    resolve.mockResolvedValue(needsSetup);
    defaultRootStatus.mockResolvedValue({ status: "valid", defaultRootAnchor: "/app" });
    snapshot = {
      ...snapshot,
      app: { ...snapshot.app, vault_root_mode: "custom_root", upriv_root_path: "/home/Music" },
    };

    render(createElement(VaultRootGate, null, createElement("main")));
    const configured = await screen.findByText("configured");
    expect(configured).toBeDefined();
    expect(screen.queryByText("error.service_unavailable")).toBeNull();
  });
});
