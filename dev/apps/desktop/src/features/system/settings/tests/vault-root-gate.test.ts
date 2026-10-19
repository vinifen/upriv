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

vi.mock("@/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

vi.mock("../AppSettingsContext", () => ({
  useAppSettingsContext: () => ({
    settings: rendered,
    settingsReady: true,
    settingsLoadFailed: false,
    vaultRootEpoch: 0,
    reloadSettings: async () => {},
    getSettingsSnapshot: () => snapshot,
  }),
}));

vi.mock("@/platform/services", () => ({
  useVaultRootService: () => ({
    resolve,
    defaultRootStatus: async () => ({ status: "missing", defaultRootAnchor: "/app" }),
    readAlias: async () => null,
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
  aliasPath: "/app/.upriv-root",
  distribution: "dev",
};

afterEach(() => {
  cleanup();
  resolve.mockReset();
  snapshot = createDefaultAppSettings();
});

describe("VaultRootGate", () => {
  it("resolves a custom folder from Setup with the settings it just loaded", async () => {
    resolve.mockResolvedValue(needsSetup);
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
});
