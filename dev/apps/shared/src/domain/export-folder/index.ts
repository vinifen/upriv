import { isAbsoluteAddress } from "../folder-lists";

/** What the folder an export writes into still needs: a folder at all, or an absolute one. */
export type ExportFolderIssue = "folder" | "folder_not_absolute";

/**
 * The step a chosen export folder still needs, or `null` when core can take
 * it. `folder` is the field as typed or picked (a phone pick is a `content://`
 * tree, which counts as absolute).
 */
export function exportFolderIssue(folder: string | null): ExportFolderIssue | null {
  const trimmed = folder?.trim() ?? "";
  if (!trimmed) return "folder";
  if (!isAbsoluteAddress(trimmed)) return "folder_not_absolute";
  return null;
}
