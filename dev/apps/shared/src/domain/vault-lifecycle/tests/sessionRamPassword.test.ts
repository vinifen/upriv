import { describe, expect, it } from "vitest";
import {
  borrowSessionRamPassword,
  commitSessionRamPasswordAfterOpen,
  shouldRetainSessionRamPassword,
} from "../sessionRamPassword";

describe("session RAM password", () => {
  it("takes the typed password out of the map for the RPC copy", () => {
    const store = new Map<string, string>([["notes", "typed"]]);
    expect(borrowSessionRamPassword(store, "notes")).toBe("typed");
    expect(store.has("notes")).toBe(false);
    expect(borrowSessionRamPassword(store, "missing")).toBe("");
  });

  it("puts the password back only after a successful open", () => {
    const store = new Map<string, string>();
    const password = "typed";
    commitSessionRamPasswordAfterOpen(store, "notes", password);
    expect(store.get("notes")).toBe("typed");
    store.delete("notes");
    commitSessionRamPasswordAfterOpen(store, "notes", "");
    expect(store.has("notes")).toBe(false);
  });

  it("leaves the map empty when unlock fails after borrow", () => {
    const store = new Map<string, string>([["notes", "wrong"]]);
    const password = borrowSessionRamPassword(store, "notes");
    expect(password).toBe("wrong");
    expect(store.has("notes")).toBe(false);
  });

  it("does not retain for always_prompt", () => {
    expect(shouldRetainSessionRamPassword("always_prompt")).toBe(false);
    expect(shouldRetainSessionRamPassword("session_ram")).toBe(true);
    expect(shouldRetainSessionRamPassword("disk_close")).toBe(true);
  });
});
