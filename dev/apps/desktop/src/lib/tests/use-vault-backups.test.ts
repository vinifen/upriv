/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { VaultBackupEntry, VaultBackupListing } from "@upriv/shared";
import { useVaultBackups } from "@upriv/shared/react";
import {
  backupEntry as entry,
  backupServiceStub as serviceWith,
  dataFolderListing as listing,
} from "./backupStubs";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

/** The stamps the hook lists, every section together. */
function stamps(sections: readonly { entries: VaultBackupEntry[] }[]): string[] {
  return sections.flatMap((section) => section.entries.map((row) => row.stamp));
}

describe("useVaultBackups", () => {
  it("ignores a stale listBackups response after the vault id changes", async () => {
    const first = deferred<VaultBackupListing>();
    const second = deferred<VaultBackupListing>();
    const backupService = serviceWith({
      listBackups: (vaultId) => (vaultId === "vault-a" ? first.promise : second.promise),
    });

    const { result, rerender } = renderHook(
      ({ vaultId }: { vaultId: string }) => useVaultBackups(backupService, vaultId, true),
      { initialProps: { vaultId: "vault-a" } },
    );

    rerender({ vaultId: "vault-b" });
    await act(async () => {
      first.resolve(listing([entry("from-a")]));
      second.resolve(listing([entry("from-b")]));
    });

    await waitFor(() => {
      expect(stamps(result.current.sections)).toEqual(["from-b"]);
    });
  });

  it("clears isBusy when the modal closes during deleteBackups", async () => {
    const hang = deferred<void>();
    const backupService = serviceWith({
      listBackups: async () => listing([entry("s1")]),
      deleteBackups: () => hang.promise,
    });

    const { result, rerender } = renderHook(
      ({ vaultId, open }: { vaultId: string | null; open: boolean }) =>
        useVaultBackups(backupService, vaultId, open),
      { initialProps: { vaultId: "vault-a" as string | null, open: true } },
    );

    await waitFor(() => {
      expect(stamps(result.current.sections)).toEqual(["s1"]);
    });

    let deleteDone: Promise<void> | undefined;
    act(() => {
      deleteDone = result.current.deleteBackups([entry("s1").key]);
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

  it("forgets a folder and reads the list again", async () => {
    let forgotten: string | null = null;
    let calls = 0;
    const backupService = serviceWith({
      listBackups: async () => {
        calls += 1;
        return listing(calls === 1 ? [entry("s1")] : []);
      },
      forgetFolder: async (_vaultId, folder) => {
        forgotten = folder;
      },
    });
    const { result } = renderHook(() => useVaultBackups(backupService, "vault-a", true));
    await waitFor(() => expect(stamps(result.current.sections)).toEqual(["s1"]));

    await act(async () => {
      await result.current.forgetFolder("f2");
    });
    expect(forgotten).toBe("f2");
    expect(stamps(result.current.sections)).toEqual([]);
  });

  it("names only a backup the list shows", async () => {
    const renamed: string[] = [];
    const backupService = serviceWith({
      listBackups: async () => listing([entry("s1")]),
      renameBackup: async (_vaultId, key, name) => {
        renamed.push(`${key}=${name}`);
        return entry("s1");
      },
    });
    const { result } = renderHook(() => useVaultBackups(backupService, "vault-a", true));
    await waitFor(() => expect(stamps(result.current.sections)).toEqual(["s1"]));

    await act(async () => {
      await result.current.renameBackup("data/unknown.zip", "Trip");
      await result.current.renameBackup(entry("s1").key, "Trip");
    });
    expect(renamed).toEqual([`${entry("s1").key}=Trip`]);
  });

  it("reloads an open list when refreshToken changes", async () => {
    let calls = 0;
    const backupService = serviceWith({
      listBackups: async () => {
        calls += 1;
        return listing([entry(calls === 1 ? "first" : "second")]);
      },
    });

    const { result, rerender } = renderHook(
      ({ token }: { token: number }) => useVaultBackups(backupService, "vault-a", true, token),
      { initialProps: { token: 0 } },
    );

    await waitFor(() => {
      expect(stamps(result.current.sections)).toEqual(["first"]);
    });

    rerender({ token: 1 });
    await waitFor(() => {
      expect(stamps(result.current.sections)).toEqual(["second"]);
    });
  });
});
