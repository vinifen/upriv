import { describe, expect, it } from "vitest";
import { RpcError } from "../../core-rpc/errors";
import { parseVaultListItemWire, parseVaultListResult } from "../parse";

describe("parseVaultListItemWire", () => {
  it("maps camelCase list rows including session and unlock preset", () => {
    const item = parseVaultListItemWire({
      id: "notes",
      displayName: "Notes",
      session: "open",
      storageMode: "encrypted_dir",
      order: 2,
      passwordHint: "hint",
      hidden: true,
      note: "hello",
      lastAccessedAt: "2026-09-11T12:00:00.000Z",
      unlockPreset: "32mib",
    });
    expect(item).toMatchObject({
      id: "notes",
      displayName: "Notes",
      session: "open",
      storageMode: "encrypted_dir",
      order: 2,
      passwordHint: "hint",
      hidden: true,
      note: "hello",
      lastAccessedAt: "2026-09-11T12:00:00.000Z",
      lastAccessedWhen: "",
      unlockPreset: "32mib",
    });
  });

  it("rejects an unknown storage mode instead of defaulting", () => {
    expect(() =>
      parseVaultListItemWire({
        id: "notes",
        displayName: "Notes",
        storageMode: "plain_only",
      }),
    ).toThrow(RpcError);
  });

  it("rejects an unknown unlock preset instead of defaulting to 256mib", () => {
    expect(() =>
      parseVaultListItemWire({
        id: "notes",
        displayName: "Notes",
        unlockPreset: "256MiB",
      }),
    ).toThrow(RpcError);
  });

  it("trims vault id padding to match persisted folder ids", () => {
    const item = parseVaultListItemWire({
      id: "  notes  ",
      displayName: "Notes",
    });
    expect(item.id).toBe("notes");
  });

  it("leaves lastAccessedWhen empty so the UI formats from the ISO stamp", () => {
    const item = parseVaultListItemWire({
      id: "notes",
      displayName: "Notes",
      lastAccessedAt: null,
    });
    expect(item.lastAccessedWhen).toBe("");
    expect(item.lastAccessedAt).toBe("");
    expect(item.session).toBeNull();
  });
});

describe("parseVaultListResult", () => {
  it("reads the vaults array", () => {
    const rows = parseVaultListResult({
      vaults: [{ id: "a", displayName: "A" }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("a");
  });

  it("rejects a missing vaults array", () => {
    expect(() => parseVaultListResult({})).toThrow(RpcError);
  });
});
