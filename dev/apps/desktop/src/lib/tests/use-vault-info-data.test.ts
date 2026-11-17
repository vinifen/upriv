/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  type BackupService,
  type FolderListService,
  type UnlockedFolderInfo,
  type VaultBackupListing,
  type VaultDiskUsage,
  type VaultLifecycleService,
  type VaultKeyStatus,
  type VaultListItem,
  type VaultRootService,
  type VaultSecurityService,
  type VaultService,
} from "@upriv/shared";
import { useVaultInfoData } from "@upriv/shared/react";
import { backupEntry, dataFolderListing } from "./backupStubs";

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

const backup = backupEntry("20260528120000", { sizeBytes: 10 });

function renderInfo(shown: VaultListItem = vault) {
  const backups = deferred<VaultBackupListing>();
  const diskUsage = deferred<VaultDiskUsage | null>();
  const unlocked = deferred<UnlockedFolderInfo>();
  const keys = deferred<VaultKeyStatus | null>();
  const vaultService = {
    getSettings: async () => null,
    diskUsage: () => diskUsage.promise,
  } as unknown as VaultService;
  const backupService = { listBackups: () => backups.promise } as unknown as BackupService;
  const lifecycleService = {
    hasPasswordInSession: () => false,
  } as unknown as VaultLifecycleService;
  const vaultRootService = {
    resolve: async () => ({ status: "found", rootPath: "/data", source: "default" }),
  } as unknown as VaultRootService;
  const folderListService = {
    unlockedFolderInfo: () => unlocked.promise,
  } as unknown as FolderListService;
  const securityService = { keyStatus: () => keys.promise } as unknown as VaultSecurityService;
  const hook = renderHook(() =>
    useVaultInfoData({
      vault: shown,
      open: true,
      groups: [],
      locale: "en",
      vaultService,
      backupService,
      lifecycleService,
      vaultRootService,
      folderListService,
      securityService,
      fallbackVaultRootBase: "/data",
    }),
  );
  return { ...hook, backups, diskUsage, unlocked, keys };
}

describe("useVaultInfoData", () => {
  it("shows Info before the backup list and store size are read", async () => {
    const { result } = renderInfo();
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    expect(result.current.snapshot?.backupSections).toBeNull();
    expect(result.current.snapshot?.unlockedFolder).toBeNull();
    expect(result.current.snapshot?.runtime.storeBytes).toBe("measuring");
    expect(result.current.snapshot?.runtime.heldBytes).toBe("measuring");
    expect(result.current.snapshot?.runtime.filesBytes).toBe("measuring");
    expect(result.current.snapshot?.storeOpenPath).toBe("/data/.upriv/vaults/notes/store");
  });

  it("fills in each slow value as it lands", async () => {
    const { result, backups, diskUsage, unlocked } = renderInfo();
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());

    const listing = dataFolderListing([backup]);
    await act(async () => backups.resolve(listing));
    expect(result.current.snapshot?.backupSections).toEqual(listing.sections);
    expect(result.current.snapshot?.runtime.storeBytes).toBe("measuring");

    const folder: UnlockedFolderInfo = {
      choice: { kind: "fixed", choice: "inherit" },
      path: "/data/upriv-unlocked/Notes",
      mounted: false,
    };
    await act(async () => unlocked.resolve(folder));
    expect(result.current.snapshot?.unlockedFolder).toEqual(folder);

    await act(async () => diskUsage.resolve({ storeBytes: 2048, heldBytes: 64, filesBytes: 1500 }));
    expect(result.current.snapshot?.runtime.storeBytes).toBe(2048);
    expect(result.current.snapshot?.runtime.heldBytes).toBe(64);
    expect(result.current.snapshot?.runtime.filesBytes).toBe(1500);
  });

  it("reads the key status of an open vault only", async () => {
    const closed = renderInfo();
    await waitFor(() => expect(closed.result.current.snapshot).not.toBeNull());
    expect(closed.result.current.snapshot?.keyStatus).toBeNull();

    const open = renderInfo({ ...vault, session: "open" });
    await waitFor(() => expect(open.result.current.snapshot).not.toBeNull());
    expect(open.result.current.snapshot?.keyStatus).toBe("reading");
    const status: VaultKeyStatus = {
      filesWaiting: 3,
      keyCopiesDue: true,
      keyCopiesUpdating: false,
    };
    await act(async () => open.keys.resolve(status));
    expect(open.result.current.snapshot?.keyStatus).toEqual(status);
  });
});
