import { describe, expect, it } from "vitest";
import { fileNameOfPath } from "../fileName";

describe("fileNameOfPath", () => {
  it("takes the last part of a Linux, Windows, or phone export path", () => {
    expect(fileNameOfPath("/media/usb/upriv-2026-10-19-101500.zip")).toBe(
      "upriv-2026-10-19-101500.zip",
    );
    expect(fileNameOfPath("E:\\Backups\\Notes 2.7z")).toBe("Notes 2.7z");
    expect(fileNameOfPath("/upriv-saf-export/Notes.zip")).toBe("Notes.zip");
  });
});
