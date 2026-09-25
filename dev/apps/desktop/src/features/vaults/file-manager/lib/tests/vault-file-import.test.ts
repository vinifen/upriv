/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { binarySourceFromDropped } from "../vaultFileImport";

describe("binarySourceFromDropped", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("streams a File with a known size without loading it as text", async () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const file = new File([payload], "clip.mkv", { type: "video/x-matroska" });
    const source = binarySourceFromDropped(file);
    expect(source.size).toBe(4);
    await expect(source.slice(0, 4)).resolves.toEqual(payload);
  });

  it("stores pdf, zip, and 7z the same way as any other dropped file", () => {
    const pdf = binarySourceFromDropped(new File([new Uint8Array([1, 2, 3])], "doc.pdf"));
    const zip = binarySourceFromDropped(new File([new Uint8Array([1, 2, 3])], "pack.zip"));
    const seven = binarySourceFromDropped(new File([new Uint8Array([1, 2, 3])], "pack.7z"));
    expect(pdf.size).toBe(3);
    expect(zip.size).toBe(3);
    expect(seven.size).toBe(3);
  });

  it("imports an empty file as a zero-byte source", async () => {
    const source = binarySourceFromDropped(new File([], "empty.dat"));
    expect(source.size).toBe(0);
    await expect(source.slice(0, 1)).resolves.toEqual(new Uint8Array());
  });

  it("falls back to an OS path when the File size is a dummy zero", async () => {
    const calls: { offset: number; len: number }[] = [];
    vi.stubGlobal("window", {
      upriv: {
        readDroppedPathRange: async (_path: string, offset: number, len: number) => {
          calls.push({ offset, len });
          return { contentB64: btoa("abcd") };
        },
      },
    });
    const source = binarySourceFromDropped(new File([], "huge.bin"), "/tmp/huge.bin", 4);
    expect(source.size).toBe(4);
    const bytes = await source.slice(0, 4);
    expect(Array.from(bytes)).toEqual([97, 98, 99, 100]);
    expect(calls[0]).toEqual({ offset: 0, len: 4 });
  });

  it("prefers an OS path over an in-memory File so large drops skip the renderer", async () => {
    const calls: { offset: number; len: number }[] = [];
    vi.stubGlobal("window", {
      upriv: {
        readDroppedPathRange: async (_path: string, offset: number, len: number) => {
          calls.push({ offset, len });
          return { contentB64: btoa("abcd") };
        },
      },
    });
    const file = new File([new Uint8Array(8)], "huge.bin");
    const source = binarySourceFromDropped(file, "/tmp/huge.bin", 4);
    expect(source.size).toBe(4);
    await source.slice(0, 4);
    expect(calls[0]).toEqual({ offset: 0, len: 4 });
  });
});
