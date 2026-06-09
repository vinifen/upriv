import type { DragEvent } from "react";
import { relativePathFromImportFile } from "./vaultImportPaths";

export interface DroppedImportFile {
  file: File;
  relativePath: string;
}

type FileSystemEntryLike = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
};

type FileSystemFileEntryLike = FileSystemEntryLike & {
  file: (
    success: (file: File) => void,
    error?: (error: DOMException) => void,
  ) => void;
};

type FileSystemDirectoryEntryLike = FileSystemEntryLike & {
  createReader: () => FileSystemDirectoryReaderLike;
};

type FileSystemDirectoryReaderLike = {
  readEntries: (
    success: (entries: FileSystemEntryLike[]) => void,
    error?: (error: DOMException) => void,
  ) => void;
};

export function isOsFileDrag(event: DragEvent): boolean {
  return event.dataTransfer.types.includes("Files");
}

function entryFromDataTransferItem(item: DataTransferItem): FileSystemEntryLike | null {
  const webkitEntry = (
    item as DataTransferItem & {
      webkitGetAsEntry?: () => FileSystemEntryLike | null;
    }
  ).webkitGetAsEntry?.();
  return webkitEntry ?? null;
}

function readAllDirectoryEntries(reader: FileSystemDirectoryReaderLike): Promise<FileSystemEntryLike[]> {
  return new Promise((resolve, reject) => {
    const collected: FileSystemEntryLike[] = [];

    const readBatch = () => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            resolve(collected);
            return;
          }
          collected.push(...batch);
          readBatch();
        },
        (error) => reject(error ?? new Error("directory read failed")),
      );
    };

    readBatch();
  });
}

async function collectEntryFiles(
  entry: FileSystemEntryLike,
  prefix: string,
  out: DroppedImportFile[],
): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => {
      (entry as FileSystemFileEntryLike).file(
        resolve,
        (error) => reject(error ?? new Error("file read failed")),
      );
    });
    const relativePath = prefix ? `${prefix}/${file.name}` : file.name;
    out.push({ file, relativePath });
    return;
  }

  if (!entry.isDirectory) return;

  const reader = (entry as FileSystemDirectoryEntryLike).createReader();
  const children = await readAllDirectoryEntries(reader);
  const dirPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;

  await Promise.all(children.map((child) => collectEntryFiles(child, dirPrefix, out)));
}

export async function filesFromDataTransfer(event: DragEvent): Promise<DroppedImportFile[]> {
  const transfer = event.dataTransfer;
  if (!transfer) return [];

  const items = Array.from(transfer.items ?? []).filter((item) => item.kind === "file");
  if (items.length > 0) {
    const collected: DroppedImportFile[] = [];

    for (const item of items) {
      const entry = entryFromDataTransferItem(item);
      if (entry) {
        await collectEntryFiles(entry, "", collected);
        continue;
      }

      const file = item.getAsFile();
      if (file && file.name.length > 0) {
        collected.push({ file, relativePath: relativePathFromImportFile(file) });
      }
    }

    if (collected.length > 0) return collected;
  }

  return Array.from(transfer.files)
    .filter((file) => file.name.length > 0)
    .map((file) => ({ file, relativePath: relativePathFromImportFile(file) }));
}

export function filesFromFileInput(fileList: FileList | null): DroppedImportFile[] {
  return Array.from(fileList ?? [])
    .filter((file) => file.name.length > 0)
    .map((file) => ({ file, relativePath: relativePathFromImportFile(file) }));
}
