import { describe, expect, it } from "vitest";
import type { DragEvent } from "react";
import { filesFromDataTransfer, filesFromFileInput, isOsFileDrag } from "../osFileDrop";

function dragEvent(partial: Partial<DataTransfer>): DragEvent {
  return { dataTransfer: partial as DataTransfer } as DragEvent;
}

describe("isOsFileDrag", () => {
  it("detects Files type", () => {
    expect(isOsFileDrag(dragEvent({ types: ["Files"] }))).toBe(true);
    expect(isOsFileDrag(dragEvent({ types: ["text/plain"] }))).toBe(false);
  });
});

describe("filesFromFileInput", () => {
  it("returns empty for null", () => {
    expect(filesFromFileInput(null)).toEqual([]);
  });

  it("skips empty names and maps relative paths", () => {
    const files = [new File(["a"], "note.md"), new File(["b"], "")] as unknown as FileList;
    Object.defineProperty(files, "length", { value: 2 });
    files[0] = new File(["a"], "note.md");
    files[1] = new File(["b"], "");

    const result = filesFromFileInput(files);
    expect(result).toHaveLength(1);
    expect(result[0]?.relativePath).toBe("note.md");
  });
});

describe("filesFromDataTransfer", () => {
  it("returns empty when transfer is missing", async () => {
    expect(await filesFromDataTransfer({ dataTransfer: null } as unknown as DragEvent)).toEqual([]);
  });

  it("falls back to transfer.files", async () => {
    const file = new File(["x"], "import.txt");
    const transfer = {
      items: [],
      files: [file],
    } as unknown as DataTransfer;
    const result = await filesFromDataTransfer(dragEvent(transfer));
    expect(result).toEqual([{ file, relativePath: "import.txt" }]);
  });

  it("uses getAsFile when webkit entry is missing", async () => {
    const file = new File(["y"], "from-item.md");
    const item = {
      kind: "file",
      getAsFile: () => file,
    };
    const transfer = {
      items: [item],
      files: [],
    } as unknown as DataTransfer;
    const result = await filesFromDataTransfer(dragEvent(transfer));
    expect(result).toEqual([{ file, relativePath: "from-item.md" }]);
  });
});
