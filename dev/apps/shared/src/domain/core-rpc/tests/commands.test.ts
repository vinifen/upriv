import { describe, expect, it } from "vitest";
import { CORE_RPC_COMMANDS, MOBILE_ONLY_RPC_COMMANDS, SHELL_ONLY_RPC_COMMANDS } from "../commands";
import contract from "./rpc-methods.json";

describe("RPC method contract", () => {
  it("matches the golden CORE / mobile-only / shell-only lists", () => {
    expect([...Object.values(CORE_RPC_COMMANDS)].sort()).toEqual([...contract.core].sort());
    expect([...Object.values(MOBILE_ONLY_RPC_COMMANDS)].sort()).toEqual(
      [...contract.mobileOnly].sort(),
    );
    expect([...Object.values(SHELL_ONLY_RPC_COMMANDS)].sort()).toEqual(
      [...contract.shellOnly].sort(),
    );
  });
});
