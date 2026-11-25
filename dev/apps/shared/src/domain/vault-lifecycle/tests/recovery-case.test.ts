import { describe, expect, it } from "vitest";
import type { PlainLeftover } from "../../vault-plain/types";
import { vaultRecoveryCase } from "../recoveryCase";

const leftover = (found: boolean): PlainLeftover => ({
  path: "/data/upriv-unlocked/Notes",
  since: "2026-01-01T00:00:00Z",
  found,
  files: found ? 2 : 0,
  bytes: found ? 10 : 0,
});

describe("vaultRecoveryCase", () => {
  it("offers nothing while the record of a leftover folder loads", () => {
    expect(vaultRecoveryCase({ plainLeftover: true, importUnfinished: true }, undefined)).toBe(
      "loading",
    );
  });

  it("wipes a leftover folder first, whatever else the vault holds", () => {
    expect(
      vaultRecoveryCase(
        { plainLeftover: true, passwordChange: "unfinished", importUnfinished: true },
        leftover(true),
      ),
    ).toBe("remove_folder");
  });

  it("finishes a password change before keeping a cut-off import", () => {
    expect(vaultRecoveryCase({ passwordChange: "unfinished", importUnfinished: true }, null)).toBe(
      "finish_password_change",
    );
  });

  it("names a cut-off import before a close that did not finish", () => {
    expect(vaultRecoveryCase({ importUnfinished: true }, null)).toBe("import_unfinished");
    expect(vaultRecoveryCase({ importUnfinished: true }, leftover(false))).toBe(
      "import_unfinished",
    );
  });

  it("asks for the new password of a pending change, else unlocks as it is", () => {
    expect(vaultRecoveryCase({ passwordChange: "pending" }, null)).toBe("password_change_pending");
    expect(vaultRecoveryCase({}, null)).toBe("unfinished_close");
    expect(vaultRecoveryCase({ plainLeftover: true }, leftover(false))).toBe("unfinished_close");
  });
});
