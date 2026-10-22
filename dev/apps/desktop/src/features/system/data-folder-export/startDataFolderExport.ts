import { dataFolderExportPending, dataFolderZipNameFromInput } from "@upriv/shared";
import type {
  DataFolderExportControls,
  DataFolderExportDestination,
} from "./dataFolderExportTypes";

/** The name and folder are set, no pick is open, and no vault work holds it back. */
export function dataFolderExportReady(
  controls: DataFolderExportControls,
  destination: DataFolderExportDestination,
): boolean {
  return (
    controls.canStart &&
    !destination.folder.picking &&
    dataFolderExportPending(destination.folder.path, destination.zipName) === null
  );
}

/**
 * Exports once ready: the footer's Export, and Enter in the name field. The
 * folder stays chosen for the next export; the name starts over once this one
 * is written.
 */
export function startDataFolderExport(
  controls: DataFolderExportControls,
  destination: DataFolderExportDestination,
): void {
  if (!dataFolderExportReady(controls, destination)) return;
  controls.onStart(destination.folder.path.trim(), dataFolderZipNameFromInput(destination.zipName));
}
