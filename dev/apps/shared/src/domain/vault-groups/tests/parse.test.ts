import { describe, expect, it } from "vitest";
import { RpcError } from "../../core-rpc/errors";
import { parseVaultGroupListResult, parseVaultGroupWire } from "../parse";

describe("parseVaultGroupWire", () => {
  it("trims id and displayName", () => {
    const group = parseVaultGroupWire({
      id: "  work  ",
      displayName: "  Work  ",
      groupedVaults: [" notes "],
    });
    expect(group.id).toBe("work");
    expect(group.displayName).toBe("Work");
    expect(group.groupedVaults).toEqual(["notes"]);
  });

  it("collapses internal whitespace in displayName", () => {
    const group = parseVaultGroupWire({
      id: "work",
      displayName: "Work    Notes",
    });
    expect(group.displayName).toBe("Work Notes");
  });

  it("reads hidden from the wire object", () => {
    const group = parseVaultGroupWire({
      id: "secrets",
      displayName: "Secrets",
      hidden: true,
    });
    expect(group.hidden).toBe(true);
  });

  it("rejects empty id after trim", () => {
    expect(() => parseVaultGroupWire({ id: "  ", displayName: "Work" })).toThrow(RpcError);
  });

  it("fills displayName from id when omitted", () => {
    const group = parseVaultGroupWire({ id: "trasdf" });
    expect(group.displayName).toBe("trasdf");
  });
});

describe("parseVaultGroupListResult", () => {
  it("reads droppedDuplicateAssignments", () => {
    const listed = parseVaultGroupListResult({
      groups: [{ id: "a", displayName: "A" }],
      invalid: false,
      droppedDuplicateAssignments: 2,
    });
    expect(listed.droppedDuplicateAssignments).toBe(2);
  });
});
