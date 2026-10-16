import { describe, expect, it } from "vitest";
import { borrowSessionRamPassword } from "../sessionRamPassword";

describe("session RAM password", () => {
  it("takes the typed password out of the map for the RPC copy", () => {
    const store = new Map<string, string>([["notes", "typed"]]);
    expect(borrowSessionRamPassword(store, "notes")).toBe("typed");
    expect(store.has("notes")).toBe(false);
    expect(borrowSessionRamPassword(store, "missing")).toBe("");
  });

  it("leaves the map empty when unlock fails after borrow", () => {
    const store = new Map<string, string>([["notes", "wrong"]]);
    const password = borrowSessionRamPassword(store, "notes");
    expect(password).toBe("wrong");
    expect(store.has("notes")).toBe(false);
  });
});
