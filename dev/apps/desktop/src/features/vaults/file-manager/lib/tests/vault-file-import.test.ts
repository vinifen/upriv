import { afterEach, describe, expect, it, vi } from "vitest";
import { readImportFileContent } from "../vaultFileImport";

describe("readImportFileContent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads text files via file.text()", async () => {
    const file = new File(["hello vault"], "note.md", { type: "text/markdown" });
    await expect(readImportFileContent(file)).resolves.toBe("hello vault");
  });

  it("returns empty string for binary extensions", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "doc.pdf");
    await expect(readImportFileContent(file)).resolves.toBe("");
  });

  it("reads images as data URLs", async () => {
    class FakeFileReader {
      result: string | null = null;
      onload: ((ev: ProgressEvent<FileReader>) => void) | null = null;
      onerror: ((ev: ProgressEvent<FileReader>) => void) | null = null;
      error: DOMException | null = null;

      readAsDataURL() {
        this.result = "data:image/png;base64,AAAA";
        queueMicrotask(() => {
          this.onload?.({} as ProgressEvent<FileReader>);
        });
      }
    }

    vi.stubGlobal("FileReader", FakeFileReader);

    const file = new File([new Uint8Array([137, 80, 78, 71])], "pic.png", { type: "image/png" });
    await expect(readImportFileContent(file)).resolves.toBe("data:image/png;base64,AAAA");
  });
});
