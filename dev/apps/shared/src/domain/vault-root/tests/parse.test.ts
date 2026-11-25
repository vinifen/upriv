import { describe, expect, it } from "vitest";
import { RpcError } from "../../core-rpc/errors";
import {
  parseDataFolderApplied,
  parseDataFolderList,
  parseDataFolderSearch,
  parseVaultRootResolve,
} from "../parse";

describe("parseVaultRootResolve", () => {
  it("reads a data folder found by each source", () => {
    for (const source of ["explicit", "default", "row"] as const) {
      expect(parseVaultRootResolve({ status: "found", rootPath: "/data", source })).toEqual({
        status: "found",
        rootPath: "/data",
        source,
      });
    }
  });

  it("keeps a relocate notice", () => {
    expect(
      parseVaultRootResolve({
        status: "found",
        rootPath: "/data",
        source: "default",
        relocateNotice: "left_behind",
        relocatePath: "C:/Program",
      }),
    ).toMatchObject({ relocateNotice: "left_behind", relocatePath: "C:/Program" });
  });

  it("reads the first run", () => {
    expect(
      parseVaultRootResolve({
        status: "needs_setup",
        defaultRootAnchor: "/app",
        distribution: "portable",
      }),
    ).toEqual({
      status: "needs_setup",
      defaultRootAnchor: "/app",
      distribution: "portable",
      ended: [],
    });
  });

  it("reads the selected choice that did not answer, a row or Default", () => {
    expect(
      parseVaultRootResolve({
        status: "selected_failed",
        choice: { kind: "row", number: 2, name: "USB" },
        reason: "missing",
        ended: ["Notes", 7],
      }),
    ).toEqual({
      status: "selected_failed",
      choice: { kind: "row", number: 2, name: "USB" },
      reason: "missing",
      ended: ["Notes"],
    });
    expect(
      parseVaultRootResolve({
        status: "selected_failed",
        choice: { kind: "fixed", choice: "default" },
        reason: "missing",
      }),
    ).toMatchObject({ choice: { kind: "fixed", choice: "default" } });
  });

  it("refuses anything else", () => {
    expect(() => parseVaultRootResolve(null)).toThrow(RpcError);
    expect(() => parseVaultRootResolve({ status: "found", rootPath: "/x" })).toThrow(RpcError);
    expect(() => parseVaultRootResolve({ status: "needs_setup", defaultRootAnchor: "/a" })).toThrow(
      RpcError,
    );
    expect(() => parseVaultRootResolve({ status: "selected_failed", reason: "missing" })).toThrow(
      RpcError,
    );
    expect(() => parseVaultRootResolve({ status: "lost" })).toThrow(RpcError);
  });
});

describe("data folder list results", () => {
  const id = "a".repeat(32);

  it("reads the list with Default's folder and each device's OS name", () => {
    const view = parseDataFolderList({
      list: {
        devices: {
          [id]: {
            system: "linux",
            selected: 1,
            next_number: 2,
            rows: [{ number: 1, name: "", path: "/media/usb" }],
          },
        },
        os_names: { [id]: "Ubuntu 24.04.5 LTS" },
      },
      defaultFolder: "/app",
      explicit: null,
    });
    expect(view.defaultFolder).toBe("/app");
    expect(view.explicit).toBeNull();
    expect(view.groups[id].selected).toBe(1);
    expect(view.osNames).toEqual({ [id]: "Ubuntu 24.04.5 LTS" });
    const empty = parseDataFolderList({ list: {}, defaultFolder: null, explicit: null });
    expect(empty.groups).toEqual({});
    expect(empty.osNames).toEqual({});
  });

  it("reads an apply and a search, with the vaults they ended", () => {
    expect(
      parseDataFolderApplied({
        rootPath: "/media/usb",
        source: "row",
        switched: true,
        privateRoot: "moved",
        ended: ["Notes"],
      }),
    ).toEqual({
      rootPath: "/media/usb",
      source: "row",
      switched: true,
      privateRoot: "moved",
      ended: ["Notes"],
    });
    expect(parseDataFolderSearch({ found: false, switch: null, ended: [] })).toEqual({
      found: false,
      switch: null,
      ended: [],
    });
  });
});
