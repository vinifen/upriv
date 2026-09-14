import { describe, expect, it } from "vitest";
import { mergeVaultListSnapshot } from "../mergeSnapshot";
import { vaultListItemFixture } from "./fixtures";

describe("mergeVaultListSnapshot", () => {
  it("keeps a local open session when the fetch started before we opened", () => {
    const current = [vaultListItemFixture({ id: "notes", session: "open" })];
    const incoming = [vaultListItemFixture({ id: "notes", session: null })];
    const writes = new Map([["notes", 200]]);
    const merged = mergeVaultListSnapshot(current, incoming, writes, 100);
    expect(merged[0]?.session).toBe("open");
  });

  it("keeps a local close (null) when the fetch started before we closed", () => {
    const current = [vaultListItemFixture({ id: "notes", session: null })];
    const incoming = [vaultListItemFixture({ id: "notes", session: "open" })];
    const writes = new Map([["notes", 200]]);
    const merged = mergeVaultListSnapshot(current, incoming, writes, 100);
    expect(merged[0]?.session).toBeNull();
  });

  it("trusts the snapshot when it started after the last local session write", () => {
    const current = [vaultListItemFixture({ id: "notes", session: "open" })];
    const incoming = [vaultListItemFixture({ id: "notes", session: null })];
    const writes = new Map([["notes", 50]]);
    const merged = mergeVaultListSnapshot(current, incoming, writes, 100);
    expect(merged[0]?.session).toBeNull();
  });

  it("uses the snapshot for vaults with no local session write", () => {
    const current = [vaultListItemFixture({ id: "notes", session: "open" })];
    const incoming = [vaultListItemFixture({ id: "notes", session: null })];
    const merged = mergeVaultListSnapshot(current, incoming, new Map(), 100);
    expect(merged[0]?.session).toBeNull();
  });

  it("keeps last-accessed only when preserving an open/closing session", () => {
    const current = [
      vaultListItemFixture({
        id: "notes",
        session: "open",
        lastAccessedAt: "local",
        lastAccessedWhen: "just now",
      }),
    ];
    const incoming = [
      vaultListItemFixture({
        id: "notes",
        session: null,
        lastAccessedAt: "from-disk",
        lastAccessedWhen: "yesterday",
      }),
    ];
    const kept = mergeVaultListSnapshot(current, incoming, new Map([["notes", 200]]), 100);
    expect(kept[0]?.lastAccessedAt).toBe("local");
    const closed = [
      vaultListItemFixture({
        id: "notes",
        session: null,
        lastAccessedAt: "local",
        lastAccessedWhen: "just now",
      }),
    ];
    const afterClose = mergeVaultListSnapshot(closed, incoming, new Map([["notes", 200]]), 100);
    expect(afterClose[0]?.lastAccessedAt).toBe("from-disk");
  });

  it("keeps renderer closing when a newer list still says core open", () => {
    const current = [vaultListItemFixture({ id: "notes", session: "closing" })];
    const incoming = [vaultListItemFixture({ id: "notes", session: "open" })];
    const merged = mergeVaultListSnapshot(current, incoming, new Map([["notes", 50]]), 100);
    expect(merged[0]?.session).toBe("closing");
  });

  it("keeps renderer closing when core already dropped the session", () => {
    const current = [vaultListItemFixture({ id: "notes", session: "closing" })];
    const incoming = [vaultListItemFixture({ id: "notes", session: null })];
    const merged = mergeVaultListSnapshot(current, incoming, new Map([["notes", 50]]), 100);
    expect(merged[0]?.session).toBe("closing");
  });

  it("keeps local last-accessed while both sides say open", () => {
    const current = [
      vaultListItemFixture({
        id: "notes",
        session: "open",
        lastAccessedAt: "local-open",
        lastAccessedWhen: "just now",
      }),
    ];
    const incoming = [
      vaultListItemFixture({
        id: "notes",
        session: "open",
        lastAccessedAt: "from-disk",
        lastAccessedWhen: "yesterday",
      }),
    ];
    const merged = mergeVaultListSnapshot(current, incoming, new Map([["notes", 50]]), 100);
    expect(merged[0]?.session).toBe("open");
    expect(merged[0]?.lastAccessedAt).toBe("local-open");
  });

  it("keeps a local-only row when its write is newer than the fetch", () => {
    const current = [vaultListItemFixture({ id: "notes" }), vaultListItemFixture({ id: "travel" })];
    const incoming = [vaultListItemFixture({ id: "notes" })];
    const merged = mergeVaultListSnapshot(current, incoming, new Map([["travel", 200]]), 100);
    expect(merged.map((row) => row.id)).toEqual(["notes", "travel"]);
  });

  it("drops a local-only row when the fetch is newer than the write", () => {
    const current = [vaultListItemFixture({ id: "notes" }), vaultListItemFixture({ id: "travel" })];
    const incoming = [vaultListItemFixture({ id: "notes" })];
    const merged = mergeVaultListSnapshot(current, incoming, new Map([["travel", 50]]), 100);
    expect(merged.map((row) => row.id)).toEqual(["notes"]);
  });
});
