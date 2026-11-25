import { describe, expect, it } from "vitest";
import { RpcError } from "../../core-rpc/errors";
import { VAULT_ERROR_CODES } from "../../vault/errors/codes";
import {
  IMPORT_BLOCKED_LIST_MAX,
  importBlockedError,
  importBlockedList,
  importSourceReason,
  parseImportBlocked,
  parseImportEnding,
} from "../importBlocked";

const blockedError = (details: unknown) =>
  new RpcError(VAULT_ERROR_CODES.IMPORT_BLOCKED, "items cannot be imported", details);

describe("parseImportBlocked", () => {
  it("reads every named item and the count of all", () => {
    expect(
      parseImportBlocked(
        blockedError({
          count: 700,
          items: [
            { path: "Work/db", reason: "permission" },
            { path: "Work/agent.sock", reason: "special" },
          ],
        }),
      ),
    ).toEqual({
      count: 700,
      items: [
        { path: "Work/db", reason: "permission" },
        { path: "Work/agent.sock", reason: "special" },
      ],
      whole: false,
    });
  });

  it("reads a reason it does not know as unreadable, and drops an item with no path", () => {
    expect(
      parseImportBlocked(
        blockedError({
          count: 2,
          items: [{ path: "Work/a", reason: "quantum" }, { reason: "permission" }, "Work/b"],
        }),
      ),
    ).toEqual({ count: 2, items: [{ path: "Work/a", reason: "unreadable" }], whole: false });
  });

  it("counts at least the items it names when the count is missing", () => {
    expect(
      parseImportBlocked(blockedError({ items: [{ path: "Work/a", reason: "missing" }] })),
    ).toEqual({ count: 1, items: [{ path: "Work/a", reason: "missing" }], whole: false });
    expect(parseImportBlocked(blockedError(undefined))).toEqual({
      count: 0,
      items: [],
      whole: false,
    });
  });

  it("knows when the chosen item itself is what blocks", () => {
    expect(
      parseImportBlocked(
        blockedError({ count: 1, items: [{ path: "notes.txt", reason: "missing" }], whole: true }),
      )?.whole,
    ).toBe(true);
  });

  it("answers null for any other error", () => {
    expect(parseImportBlocked(new RpcError("wrong_password", "no"))).toBeNull();
    expect(parseImportBlocked(new Error("import_blocked: no"))).toBeNull();
  });
});

describe("importBlockedError", () => {
  it("counts every item and names the first ones in path order", () => {
    const found = Array.from({ length: IMPORT_BLOCKED_LIST_MAX + 2 }, (_, index) => ({
      path: `Photos/${String(IMPORT_BLOCKED_LIST_MAX + 2 - index).padStart(4, "0")}`,
      reason: "unreadable" as const,
    }));
    const parsed = parseImportBlocked(importBlockedError(found, false));
    expect(parsed?.count).toBe(IMPORT_BLOCKED_LIST_MAX + 2);
    expect(parsed?.items).toHaveLength(IMPORT_BLOCKED_LIST_MAX);
    expect(parsed?.items[0].path).toBe("Photos/0001");
    const paths = parsed?.items.map((item) => item.path) ?? [];
    expect(paths).toEqual([...paths].sort());
    expect(parsed?.whole).toBe(false);
  });
});

describe("importBlockedList", () => {
  it("counts at least the items given, and keeps the count beyond the names", () => {
    const items = [
      { path: "b", reason: "special" as const },
      { path: "a", reason: "permission" as const },
    ];
    expect(importBlockedList(items, 0, false)).toEqual({
      count: 2,
      items: [items[1], items[0]],
      whole: false,
    });
    expect(importBlockedList(items, 900, true).count).toBe(900);
  });
});

describe("importSourceReason", () => {
  it("reads why core could not read a file", () => {
    const unread = (details: unknown) =>
      new RpcError(VAULT_ERROR_CODES.IMPORT_SOURCE_UNREADABLE, "no", details);
    expect(importSourceReason(unread({ path: "/a", reason: "permission" }))).toBe("permission");
    expect(importSourceReason(unread({ reason: "link" }))).toBe("link");
    expect(importSourceReason(unread(undefined))).toBe("unreadable");
    expect(importSourceReason(unread({ reason: "quantum" }))).toBe("unreadable");
  });

  it("answers null for a failure of the vault", () => {
    expect(importSourceReason(new RpcError("io_error", "disk full"))).toBeNull();
    expect(importSourceReason(new Error("import_source_unreadable"))).toBeNull();
  });
});

describe("parseImportEnding", () => {
  it("reads a count, and anything else as none", () => {
    expect(parseImportEnding({ leftOut: 3 }).leftOut).toBe(3);
    expect(parseImportEnding({}).leftOut).toBe(0);
    expect(parseImportEnding({ leftOut: -2 }).leftOut).toBe(0);
    expect(parseImportEnding({ leftOut: "3" }).leftOut).toBe(0);
  });

  it("reads a stop only from stopped: true", () => {
    expect(parseImportEnding({ stopped: true }).stopped).toBe(true);
    expect(parseImportEnding({}).stopped).toBe(false);
    expect(parseImportEnding({ stopped: "true" }).stopped).toBe(false);
  });
});
