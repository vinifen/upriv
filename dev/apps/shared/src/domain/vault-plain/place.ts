import type { WorkspaceOsEntry, WorkspaceSystem } from "../workspace";

export type PlainPlaceChoice = "default" | "custom" | "vault_only";

/**
 * Save the place the open modal chose. Default and custom update this
 * system's workspace. This vault only writes that vault's folder path.
 */
export async function applyPlainPlaceChoice(input: {
  choice: PlainPlaceChoice;
  path: string;
  system: WorkspaceSystem;
  saveWorkspace: (entry: WorkspaceOsEntry) => Promise<boolean>;
  saveVaultFolder: (path: string) => Promise<void>;
}): Promise<void> {
  if (input.choice === "default") {
    const saved = await input.saveWorkspace({ place: "beside", path: "" });
    if (!saved) throw new Error("workspace was not saved");
    return;
  }
  const path = input.path.trim();
  if (!path) throw new Error("folder path is empty");
  if (input.choice === "custom") {
    const saved = await input.saveWorkspace({ place: "custom", path });
    if (!saved) throw new Error("workspace was not saved");
    return;
  }
  await input.saveVaultFolder(path);
}
