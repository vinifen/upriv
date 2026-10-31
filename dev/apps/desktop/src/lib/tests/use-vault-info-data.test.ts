/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  appWorkspace,
  type BackupService,
  type VaultBackupEntry,
  type VaultLifecycleService,
  type VaultListItem,
  type VaultRootService,
  type VaultService,
} from "@upriv/shared";
import { useVaultInfoData } from "@upriv/shared/react";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

const vault: VaultListItem = {
  id: "notes",
  displayName: "Notes",
  session: null,
  storageMode: "encrypted_dir",
  lastAccessedWhen: "—",
  lastAccessedAt: "2026-01-01T00:00:00.000Z",
  note: "",
};

const backup: VaultBackupEntry = {
  stamp: "20260528120000",
  fileName: "20260528120000-notes.zip",
  createdAt: "2026-05-28T12:00:00.000Z",
  sizeBytes: 10,
};

function renderInfo() {
  const backups = deferred<VaultBackupEntry[]>();
  const storeBytes = deferred<number | null>();
  const vaultService = {
    getSettings: async () => null,
    storeOnDiskBytes: () => storeBytes.promise,
  } as unknown as VaultService;
  const backupService = { listBackups: () => backups.promise } as unknown as BackupService;
  const lifecycleService = {
    hasPasswordInSession: () => false,
  } as unknown as VaultLifecycleService;
  const vaultRootService = {
    resolve: async () => ({ status: "found", rootPath: "/data", source: "default_root" }),
  } as unknown as VaultRootService;
  const workspace = appWorkspace();
  const hook = renderHook(() =>
    useVaultInfoData({
      vault,
      open: true,
      groups: [],
      locale: "en",
      vaultService,
      backupService,
      lifecycleService,
      vaultRootService,
      vaultRootMode: "default_root",
      workspace,
      fallbackVaultRootBase: "/data",
    }),
  );
  return { ...hook, backups, storeBytes };
}

describe("useVaultInfoData", () => {
  it("shows Info before the backup list and store size are read", async () => {
    const { result } = renderInfo();
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    expect(result.current.snapshot?.backups).toBeNull();
    expect(result.current.snapshot?.runtime.storeBytes).toBe("measuring");
    expect(result.current.snapshot?.storeOpenPath).toBe("/data/.upriv/vaults/notes/store");
  });

  it("fills in each slow value as it lands", async () => {
    const { result, backups, storeBytes } = renderInfo();
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());

    await act(async () => backups.resolve([backup]));
    expect(result.current.snapshot?.backups).toEqual([backup]);
    expect(result.current.snapshot?.runtime.storeBytes).toBe("measuring");

    await act(async () => storeBytes.resolve(2048));
    expect(result.current.snapshot?.runtime.storeBytes).toBe(2048);
  });
});
