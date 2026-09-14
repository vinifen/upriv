import { describe, expect, it } from "vitest";
import { vaultRowFixture } from "../../vault/tests/fixtures.shared";
import { rebaseQuietLockedVaultSettings } from "../rebaseQuiet";
import { vaultSettingsFixture } from "./fixtures";

const baseline = vaultSettingsFixture({
  vault: { id: "notes", display_name: "Notes" },
});

describe("rebaseQuietLockedVaultSettings", () => {
  it("keeps quiet dirty when vault is quiet", () => {
    const closed = vaultRowFixture({ id: "notes" });
    const draft = {
      ...baseline,
      vault: { ...baseline.vault, display_name: "Renamed", note: "x" },
    };
    expect(rebaseQuietLockedVaultSettings(draft, baseline, closed)).toEqual(draft);
  });

  it("rebases quiet fields to baseline when open, keeps anytime", () => {
    const open = vaultRowFixture({ id: "notes", session: "open" });
    const draft = {
      ...baseline,
      vault: { ...baseline.vault, display_name: "Renamed", note: "keep" },
      storage: { mode: "upriv_plain" as const },
      security: { ...baseline.security, mode: "always_prompt" as const },
      mount: { workspace_path: "/tmp/custom" },
    };
    const rebased = rebaseQuietLockedVaultSettings(draft, baseline, open);
    expect(rebased.vault.display_name).toBe("Notes");
    expect(rebased.vault.note).toBe("keep");
    expect(rebased.storage.mode).toBe("encrypted_dir");
    expect(rebased.security.mode).toBe("session_ram");
    expect(rebased.mount.workspace_path).toBe("default");
  });
});
