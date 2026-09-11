import { describe, expect, it } from "vitest";
import { CORE_RPC_COMMANDS, DESKTOP_ONLY_RPC_COMMANDS, SHELL_ONLY_RPC_COMMANDS } from "../commands";
import contract from "./rpc-methods.json";

describe("RPC method contract", () => {
  it("matches the golden CORE / desktop-only / shell-only lists", () => {
    expect([...Object.values(CORE_RPC_COMMANDS)].sort()).toEqual([...contract.core].sort());
    expect([...Object.values(DESKTOP_ONLY_RPC_COMMANDS)].sort()).toEqual(
      [...contract.desktopOnly].sort(),
    );
    expect([...Object.values(SHELL_ONLY_RPC_COMMANDS)].sort()).toEqual(
      [...contract.shellOnly].sort(),
    );
  });
});
