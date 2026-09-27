import { describe, expect, it } from "vitest";
import { classifyImportCachePath, type ImportCacheRoots } from "../importCachePath";

const roots: ImportCacheRoots = {
  cacheOs: "/data/user/0/app/cache",
  cacheUri: "file:///data/user/0/app/cache",
};

describe("classifyImportCachePath", () => {
  it("treats a document-picker copy in cache as one file", () => {
    expect(classifyImportCachePath("/data/user/0/app/cache/DocumentPicker/note.txt", roots)).toBe(
      "file",
    );
    expect(
      classifyImportCachePath("file:///data/user/0/app/cache/DocumentPicker/note.txt", roots),
    ).toBe("file");
  });

  it("leaves the user's own files and the cache directory itself", () => {
    expect(classifyImportCachePath("/home/vini/Photos", roots)).toBe("leave");
    expect(classifyImportCachePath("content://tree/photos", roots)).toBe("leave");
    expect(classifyImportCachePath("/data/user/0/app/cache", roots)).toBe("leave");
    expect(classifyImportCachePath("/data/user/0/app/cache-other/note.txt", roots)).toBe("leave");
    expect(classifyImportCachePath("/data/user/0/app/cache/../files/secret", roots)).toBe("leave");
    expect(classifyImportCachePath("", roots)).toBe("leave");
  });
});
