import { describe, expect, it } from "vitest";
import { revealableLocation } from "../revealableLocation";

describe("revealableLocation", () => {
  it("keeps absolute OS paths and content URIs", () => {
    expect(revealableLocation("/data/.upriv/logs")).toBe("/data/.upriv/logs");
    expect(revealableLocation("  C:\\Users\\vault  ")).toBe("C:\\Users\\vault");
    expect(revealableLocation("\\\\server\\share\\upriv")).toBe("\\\\server\\share\\upriv");
    expect(revealableLocation("content://com.android.externalstorage/tree/primary")).toBe(
      "content://com.android.externalstorage/tree/primary",
    );
    expect(revealableLocation("CONTENT://com.android.externalstorage/tree/primary")).toBe(
      "CONTENT://com.android.externalstorage/tree/primary",
    );
  });

  it("drops labels, relatives, and empty values", () => {
    expect(revealableLocation(null)).toBeUndefined();
    expect(revealableLocation(undefined)).toBeUndefined();
    expect(revealableLocation("")).toBeUndefined();
    expect(revealableLocation("   ")).toBeUndefined();
    expect(revealableLocation("—")).toBeUndefined();
    expect(revealableLocation("default")).toBeUndefined();
    expect(revealableLocation("file:///tmp/vault")).toBeUndefined();
    expect(revealableLocation("vaults/notes/backups/20260528.zip")).toBeUndefined();
    expect(revealableLocation("content://tree · .upriv/vaults/notes/store")).toBeUndefined();
    expect(revealableLocation("/tmp/\u0000etc")).toBeUndefined();
  });
});
