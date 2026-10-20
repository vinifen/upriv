import { describe, expect, it, vi } from "vitest";
import { createDestinationGrant } from "../destinationGrant";

const USB = "content://com.android.externalstorage.documents/tree/USB%3ABackups";
const SD = "content://com.android.externalstorage.documents/tree/SD%3ACopies";

describe("createDestinationGrant", () => {
  it("lets the old folder go when another is picked, and keeps a repeat pick", () => {
    const release = vi.fn();
    const grant = createDestinationGrant(release);

    grant.pick(USB);
    grant.pick(USB);
    expect(release).not.toHaveBeenCalled();

    grant.pick(SD);
    expect(release).toHaveBeenCalledExactlyOnceWith(USB);
    expect(grant.held()).toBe(SD);
  });

  it("keeps holding the folder until the vault list lets it go", () => {
    const release = vi.fn();
    const grant = createDestinationGrant(release);

    grant.pick(USB);
    expect(grant.held()).toBe(USB);
    expect(release).not.toHaveBeenCalled();
  });

  it("lets the folder go once when the vault list goes away", () => {
    const release = vi.fn();
    const grant = createDestinationGrant(release);

    grant.pick(USB);
    grant.clear();
    grant.clear();
    expect(release).toHaveBeenCalledExactlyOnceWith(USB);
  });
});
