import { describe, expect, it, vi } from "vitest";
import { createExportFolderHold } from "../exportFolderHold";

const USB = "content://com.android.externalstorage.documents/tree/USB%3ABackups";
const SD = "content://com.android.externalstorage.documents/tree/SD%3ACopies";

function grants() {
  return { hold: vi.fn(), release: vi.fn() };
}

describe("createExportFolderHold", () => {
  it("holds a picked folder, and keeps a repeat pick without a second hold", () => {
    const access = grants();
    const field = createExportFolderHold(access);

    field.pick(USB);
    field.pick(USB);
    expect(access.hold).toHaveBeenCalledExactlyOnceWith(USB);
    expect(access.release).not.toHaveBeenCalled();
    expect(field.held()).toBe(USB);
  });

  it("lets the old folder go once another is held", () => {
    const access = grants();
    const field = createExportFolderHold(access);

    field.pick(USB);
    field.pick(SD);
    expect(access.hold).toHaveBeenLastCalledWith(SD);
    expect(access.release).toHaveBeenCalledExactlyOnceWith(USB);
    expect(field.held()).toBe(SD);
  });

  it("lets a late pick go without touching the held folder", () => {
    const access = grants();
    const field = createExportFolderHold(access);

    field.pick(USB);
    field.drop(SD);
    field.drop(USB);
    expect(access.release).toHaveBeenCalledExactlyOnceWith(SD);
    expect(field.held()).toBe(USB);
  });

  it("lets its folder go once when the field goes away", () => {
    const access = grants();
    const field = createExportFolderHold(access);

    field.pick(USB);
    field.clear();
    field.clear();
    expect(access.release).toHaveBeenCalledExactlyOnceWith(USB);
    expect(field.held()).toBeNull();
  });

  it("only remembers the folder without storage access", () => {
    const field = createExportFolderHold(undefined);
    field.pick(USB);
    expect(field.held()).toBe(USB);
    field.clear();
    expect(field.held()).toBeNull();
  });
});
