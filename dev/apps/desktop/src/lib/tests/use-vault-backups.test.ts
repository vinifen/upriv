/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BackupService, VaultBackupEntry } from "@upriv/shared";
import { useVaultBackups } from "@upriv/shared/react";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function entry(stamp: string): VaultBackupEntry {
  return { stamp, createdAt: "2026-01-01T00:00:00.000Z" };
}

describe("useVaultBackups", () => {
  it("ignores a stale listBackups response after the vault id changes", async () => {
    const first = deferred<VaultBackupEntry[]>();
    const second = deferred<VaultBackupEntry[]>();
    const backupService: BackupService = {
      listBackups: (vaultId) => (vaultId === "vault-a" ? first.promise : second.promise),
      deleteBackups: async () => undefined,
      promoteToSave: async () => undefined,
      getBackupBytes: async () => new Uint8Array(),
    };

    const { result, rerender } = renderHook(
      ({ vaultId }: { vaultId: string }) => useVaultBackups(backupService, vaultId, true),
      { initialProps: { vaultId: "vault-a" } },
    );

    rerender({ vaultId: "vault-b" });
    await act(async () => {
      first.resolve([entry("from-a")]);
      second.resolve([entry("from-b")]);
    });

    await waitFor(() => {
      expect(result.current.backups.map((row) => row.stamp)).toEqual(["from-b"]);
    });
  });

  it("clears isBusy when the modal closes during deleteBackups", async () => {
    const hang = deferred<void>();
    const backupService: BackupService = {
      listBackups: async () => [entry("s1")],
      deleteBackups: () => hang.promise,
      promoteToSave: async () => undefined,
      getBackupBytes: async () => new Uint8Array(),
    };

    const { result, rerender } = renderHook(
      ({ vaultId, open }: { vaultId: string | null; open: boolean }) =>
        useVaultBackups(backupService, vaultId, open),
      { initialProps: { vaultId: "vault-a" as string | null, open: true } },
    );

    await waitFor(() => {
      expect(result.current.backups.map((row) => row.stamp)).toEqual(["s1"]);
    });

    let deleteDone: Promise<void> | undefined;
    act(() => {
      deleteDone = result.current.deleteBackups(["s1"]);
    });
    expect(result.current.isBusy).toBe(true);

    rerender({ vaultId: null, open: false });
    expect(result.current.isBusy).toBe(false);

    await act(async () => {
      hang.resolve();
      await deleteDone;
    });
    expect(result.current.isBusy).toBe(false);
  });
});
