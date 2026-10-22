/**
 * The storage-access grants behind folders picked for an export on a phone:
 * the Data folder window's Export a copy, and the vault export's `.zip` and
 * `.7z` folders. Each one holds the folder it keeps and lets it go when it is
 * replaced or the vault list goes away. Android drops the picker's access
 * only once nothing holds that folder and no export is writing there, so two
 * fields may keep the same folder.
 */
export interface ExportFolderGrants {
  hold(folder: string): void;
  release(folder: string): void;
}
