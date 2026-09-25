import { relativePathFromImportFile } from "./vaultImportPaths";

export interface DroppedImportFile {
  file: File;
  relativePath: string;
  osPath?: string;
  byteSize?: number;
}

export type FileDropEvent = {
  preventDefault: () => void;
  stopPropagation: () => void;
  dataTransfer: DataTransfer | null;
};

type FileSystemEntryLike = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
};

type FileSystemFileEntryLike = FileSystemEntryLike & {
  file: (success: (file: File) => void, error?: (error: DOMException) => void) => void;
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

const OS_FILE_DRAG_TYPES = ["Files", "text/uri-list", "application/x-moz-file"] as const;

export type OsDropSnapshot = {
  files: DroppedImportFile[];
  pending: Promise<DroppedImportFile[]>;
  osPaths: string[];
  hasDirectory: boolean;
  /** XDG FileTransfer portal key (GTK4/Nautilus). */
  portalKey?: string;
};

function dataTransferHasOsFileType(types: DataTransfer["types"] | undefined): boolean {
  if (!types) return false;
  const contains = (types as unknown as { contains?: (type: string) => boolean }).contains;
  if (typeof contains === "function") {
    return OS_FILE_DRAG_TYPES.some((type) => contains.call(types, type));
  }
  try {
    return Array.from(types as ArrayLike<string>).some((type) =>
      (OS_FILE_DRAG_TYPES as readonly string[]).includes(type),
    );
  } catch {
    return false;
  }
}

export function isOsFileDrag(event: FileDropEvent): boolean {
  const transfer = event.dataTransfer;
  if (!transfer) return false;
  if (dataTransferHasOsFileType(transfer.types)) return true;
  try {
    if (transfer.files && transfer.files.length > 0) return true;
  } catch {
    /* FileList may be unavailable during dragover */
  }
  try {
    const items = transfer.items;
    if (items && Array.from(items).some((item) => item.kind === "file")) return true;
  } catch {
    /* DataTransferItemList may be restricted */
  }
  return false;
}

/**
 * HTML5/Electron: drop never fires unless the last dragover called preventDefault.
 * Linux often leaves `types` empty during dragover — do not gate on isOsFileDrag.
 */
export function allowFileManagerDrop(
  event: { preventDefault: () => void; dataTransfer: DataTransfer | null },
  dropEffect: "copy" | "move" | "none" = "copy",
): void {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = dropEffect;
}

function entryFromDataTransferItem(item: DataTransferItem): FileSystemEntryLike | null {
  const webkitEntry = (
    item as DataTransferItem & {
      webkitGetAsEntry?: () => FileSystemEntryLike | null;
    }
  ).webkitGetAsEntry?.();
  return webkitEntry ?? null;
}

function normalizeOsPath(osPath: string): string {
  const normalized = osPath.trim().replace(/\\/g, "/").replace(/\/+$/u, "");
  // `C:\` would otherwise become `C:`, which Node treats as a relative cwd.
  if (/^[A-Za-z]:$/u.test(normalized)) return `${normalized}/`;
  return normalized;
}

function basenameFromOsPath(osPath: string): string {
  const normalized = normalizeOsPath(osPath);
  if (!normalized) return "";
  const parts = normalized.split("/");
  return parts[parts.length - 1] ?? "";
}

function isWinDrivePath(path: string): boolean {
  return /^[A-Za-z]:\//.test(path);
}

/** Windows paths compare case-insensitively. Linux and macOS stay case-sensitive. */
function pathKey(path: string): string {
  return isWinDrivePath(path) ? path.toLowerCase() : path;
}

function pathCovers(root: string, candidate: string): boolean {
  const rootKey = pathKey(normalizeOsPath(root));
  const key = pathKey(normalizeOsPath(candidate));
  if (!rootKey || !key) return false;
  if (key === rootKey) return true;
  const prefix = rootKey.endsWith("/") ? rootKey : `${rootKey}/`;
  return key.startsWith(prefix);
}

/** Drop a path when an ancestor directory in the same drop will already be walked. */
function rootOsPaths(paths: readonly string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of paths) {
    const path = normalizeOsPath(raw);
    if (!path) continue;
    const key = pathKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(path);
  }
  return unique.filter(
    (path) => !unique.some((other) => other !== path && pathCovers(other, path)),
  );
}

function fileUrlToPath(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "file:") return null;
    let osPath = decodeURIComponent(parsed.pathname);
    if (/^\/[A-Za-z]:\//.test(osPath)) osPath = osPath.slice(1);
    return osPath || null;
  } catch {
    return null;
  }
}

function absolutePathFromFile(file: File): string | undefined {
  const legacy = (file as File & { path?: string }).path?.trim();
  if (legacy) return legacy;
  if (typeof window === "undefined") return undefined;
  const api = window.upriv;
  if (!api || typeof api.getPathForFile !== "function") return undefined;
  try {
    return api.getPathForFile(file)?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function droppedFileName(file: File): string {
  const named = file.name.trim();
  if (named) return named;
  const osPath = absolutePathFromFile(file);
  return osPath ? basenameFromOsPath(osPath) : "";
}

function fileWithDisplayName(file: File): File | null {
  const name = droppedFileName(file);
  if (!name) return null;
  if (file.name === name) return file;
  try {
    Object.defineProperty(file, "name", { value: name, configurable: true });
    return file;
  } catch {
    return new File([file], name, { type: file.type, lastModified: file.lastModified });
  }
}

function droppedFromFile(file: File): DroppedImportFile | null {
  const named = fileWithDisplayName(file);
  if (!named) return null;
  const relative = relativePathFromImportFile(named);
  const osPath = absolutePathFromFile(named) ?? absolutePathFromFile(file);
  return {
    file: named,
    relativePath: relative || named.name,
    ...(osPath ? { osPath, byteSize: named.size > 0 ? named.size : undefined } : {}),
  };
}

function readTransferData(transfer: DataTransfer, type: string): string {
  try {
    return transfer.getData(type) ?? "";
  } catch {
    return "";
  }
}

function readUriList(transfer: DataTransfer): string {
  const listed = readTransferData(transfer, "text/uri-list");
  if (listed.trim()) return listed;
  const plain = readTransferData(transfer, "text/plain");
  if (plain.includes("file:")) return plain;
  return "";
}

function readPortalTransferKey(transfer: DataTransfer): string | undefined {
  for (const type of [
    "application/vnd.portal.filetransfer",
    "application/vnd.portal.files",
  ] as const) {
    const key = readTransferData(transfer, type).trim();
    if (key) return key;
  }
  return undefined;
}

function collectOsPaths(transfer: DataTransfer, files: File[]): string[] {
  const paths = new Set<string>();
  for (const file of files) {
    const osPath = absolutePathFromFile(file);
    if (osPath) paths.add(osPath);
  }
  for (const line of readUriList(transfer).split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const osPath = fileUrlToPath(trimmed);
    if (osPath) paths.add(osPath);
  }
  // Nautilus also offers `x-special/gnome-copied-files`: "copy\nfile:///..."
  for (const line of readTransferData(transfer, "x-special/gnome-copied-files").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "copy" || trimmed === "cut" || trimmed === "link") continue;
    const osPath = fileUrlToPath(trimmed);
    if (osPath) paths.add(osPath);
  }
  return [...paths];
}

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function fileFromB64(b64: string, name: string): File {
  const bytes = b64ToBytes(b64);
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new File([copy], name);
}

type DroppedStatRow = { relativePath: string; osPath: string; size: number };

type OsPathWalk = { files: DroppedImportFile[]; unreadable: string[]; truncated: boolean };

export type ListedOsDrop = {
  files: DroppedImportFile[];
  /** The OS walk stopped before every file was listed. */
  truncated: boolean;
};

function isStatRow(value: unknown): value is DroppedStatRow {
  if (!value || typeof value !== "object") return false;
  const row = value as DroppedStatRow;
  return (
    typeof row.relativePath === "string" &&
    typeof row.osPath === "string" &&
    typeof row.size === "number"
  );
}

function statRowsFromApi(stats: unknown): {
  rows: DroppedStatRow[];
  unreadable: string[];
  truncated: boolean;
} {
  if (Array.isArray(stats))
    return { rows: stats.filter(isStatRow), unreadable: [], truncated: false };
  if (!stats || typeof stats !== "object") return { rows: [], unreadable: [], truncated: false };
  const record = stats as { files?: unknown; unreadable?: unknown; truncated?: unknown };
  return {
    rows: Array.isArray(record.files) ? record.files.filter(isStatRow) : [],
    unreadable: Array.isArray(record.unreadable)
      ? record.unreadable.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0,
        )
      : [],
    truncated: record.truncated === true,
  };
}

function contentRowsFromApi(raw: unknown): {
  rows: { relativePath: string; contentB64: string }[];
  truncated: boolean;
} {
  if (Array.isArray(raw)) {
    return {
      rows: raw.filter(
        (row): row is { relativePath: string; contentB64: string } =>
          !!row &&
          typeof row === "object" &&
          typeof (row as { relativePath?: unknown }).relativePath === "string" &&
          typeof (row as { contentB64?: unknown }).contentB64 === "string",
      ),
      truncated: false,
    };
  }
  if (!raw || typeof raw !== "object") return { rows: [], truncated: false };
  const record = raw as { files?: unknown; truncated?: unknown };
  const files = Array.isArray(record.files) ? record.files : [];
  return {
    rows: files.filter(
      (row): row is { relativePath: string; contentB64: string } =>
        !!row &&
        typeof row === "object" &&
        typeof (row as { relativePath?: unknown }).relativePath === "string" &&
        typeof (row as { contentB64?: unknown }).contentB64 === "string",
    ),
    truncated: record.truncated === true,
  };
}

function fileFromStat(row: DroppedStatRow): DroppedImportFile {
  const name = row.relativePath.split("/").pop() || "file";
  return {
    file: new File([], name),
    relativePath: row.relativePath,
    osPath: row.osPath,
    byteSize: row.size,
  };
}

async function filesFromOsPaths(paths: string[]): Promise<OsPathWalk | null> {
  if (paths.length === 0) return null;
  const api = typeof window === "undefined" ? undefined : window.upriv;
  if (!api) return null;

  if (typeof api.statDroppedPaths === "function") {
    const { rows, unreadable, truncated } = statRowsFromApi(await api.statDroppedPaths(paths));
    return { files: rows.map(fileFromStat), unreadable, truncated };
  }

  if (typeof api.readDroppedPaths !== "function") return null;
  const content = contentRowsFromApi(await api.readDroppedPaths(paths));
  return {
    files: content.rows.map((row) => {
      const name = row.relativePath.split("/").pop() || "file";
      return { file: fileFromB64(row.contentB64, name), relativePath: row.relativePath };
    }),
    unreadable: [],
    truncated: content.truncated,
  };
}

function blobWhenPathUnreadable(dropped: DroppedImportFile): DroppedImportFile | null {
  if (dropped.file.size <= 0) return null;
  return { file: dropped.file, relativePath: dropped.relativePath };
}

function readAllDirectoryEntries(
  reader: FileSystemDirectoryReaderLike,
): Promise<FileSystemEntryLike[]> {
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
      (entry as FileSystemFileEntryLike).file(resolve, (error) =>
        reject(error ?? new Error("file read failed")),
      );
    });
    const dropped = droppedFromFile(file);
    if (!dropped) return;
    const relativePath = prefix ? `${prefix}/${dropped.file.name}` : dropped.relativePath;
    out.push({ ...dropped, relativePath });
    return;
  }

  if (!entry.isDirectory) return;

  const reader = (entry as FileSystemDirectoryEntryLike).createReader();
  const children = await readAllDirectoryEntries(reader);
  const dirPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;

  await Promise.all(children.map((child) => collectEntryFiles(child, dirPrefix, out)));
}

function collectEntryFilesLater(entry: FileSystemEntryLike): Promise<DroppedImportFile[]> {
  return (async () => {
    const out: DroppedImportFile[] = [];
    await collectEntryFiles(entry, "", out);
    return out;
  })();
}

export function snapshotLooksLikeOsImport(snapshot: OsDropSnapshot): boolean {
  return (
    snapshot.files.length > 0 ||
    snapshot.hasDirectory ||
    snapshot.osPaths.length > 0 ||
    Boolean(snapshot.portalKey)
  );
}

/**
 * Copy File / FileSystemEntry / file: URI handles during the drop event.
 * Chromium clears `dataTransfer` after the handler returns; do not await first.
 */
export function snapshotOsFileDrop(event: FileDropEvent): OsDropSnapshot {
  const transfer = event.dataTransfer;
  if (!transfer) {
    return { files: [], pending: Promise.resolve([]), osPaths: [], hasDirectory: false };
  }

  const files: DroppedImportFile[] = [];
  const pending: Promise<DroppedImportFile[]>[] = [];
  const rawFiles = Array.from(transfer.files ?? []);
  let hasDirectory = false;
  const items = Array.from(transfer.items ?? []);

  for (const item of items) {
    if (item.kind !== "file") continue;
    const entry = entryFromDataTransferItem(item);
    if (entry?.isDirectory) {
      hasDirectory = true;
      pending.push(collectEntryFilesLater(entry));
      continue;
    }

    const asFile = item.getAsFile();
    if (asFile) rawFiles.push(asFile);
    const dropped = asFile ? droppedFromFile(asFile) : null;
    if (dropped) {
      files.push(dropped);
      continue;
    }
    if (entry?.isFile) pending.push(collectEntryFilesLater(entry));
  }

  if (files.length === 0 && pending.length === 0) {
    for (const file of rawFiles) {
      const dropped = droppedFromFile(file);
      if (dropped) files.push(dropped);
    }
  }

  return {
    files,
    hasDirectory,
    osPaths: collectOsPaths(transfer, rawFiles),
    portalKey: readPortalTransferKey(transfer),
    pending:
      pending.length > 0
        ? Promise.all(pending).then((groups) => groups.flat())
        : Promise.resolve([]),
  };
}

export async function listFilesFromOsDropSnapshot(snapshot: OsDropSnapshot): Promise<ListedOsDrop> {
  const extra = await snapshot.pending;
  const collected = extra.length > 0 ? [...snapshot.files, ...extra] : [...snapshot.files];

  const osPaths = [...snapshot.osPaths];
  if (snapshot.portalKey) {
    const api = typeof window === "undefined" ? undefined : window.upriv;
    if (api && typeof api.retrievePortalDrop === "function") {
      try {
        const portalPaths = await api.retrievePortalDrop(snapshot.portalKey);
        for (const path of portalPaths) {
          if (path.trim()) osPaths.push(path.trim());
        }
      } catch {
        /* portal retrieve is best-effort */
      }
    }
  }

  const roots = rootOsPaths(osPaths);
  // Prefer OS paths whenever available: Linux folder drops arrive as a single
  // `File` with a non-zero directory size (often 4096), not an empty stub.
  // A root the main process could not stat keeps its browser `File` bytes.
  if (roots.length > 0) {
    const fromDisk = await filesFromOsPaths(roots);
    if (!fromDisk) return { files: collected, truncated: false };
    if (fromDisk.unreadable.length === 0) {
      if (fromDisk.files.length > 0) {
        return { files: fromDisk.files, truncated: fromDisk.truncated };
      }
      const walked = new Set(roots.map((root) => pathKey(root)));
      return {
        files: collected.filter((dropped) => {
          if (!dropped.osPath) return true;
          return !walked.has(pathKey(normalizeOsPath(dropped.osPath)));
        }),
        truncated: fromDisk.truncated,
      };
    }
    const kept = collected.flatMap((dropped) => {
      if (!dropped.osPath) return [dropped];
      const unread = fromDisk.unreadable.some((root) => pathCovers(root, dropped.osPath ?? ""));
      if (!unread) return [];
      const blob = blobWhenPathUnreadable(dropped);
      return blob ? [blob] : [];
    });
    return { files: [...fromDisk.files, ...kept], truncated: fromDisk.truncated };
  }
  return { files: collected, truncated: false };
}

export async function filesFromOsDropSnapshot(
  snapshot: OsDropSnapshot,
): Promise<DroppedImportFile[]> {
  return (await listFilesFromOsDropSnapshot(snapshot)).files;
}

export async function filesFromDataTransfer(event: FileDropEvent): Promise<DroppedImportFile[]> {
  return filesFromOsDropSnapshot(snapshotOsFileDrop(event));
}

export function beginOsFileImport(
  event: FileDropEvent,
  parentPath: string,
  importSnapshot: (
    parentPath: string,
    snapshot: OsDropSnapshot,
    options?: { openFirstViewable?: boolean },
  ) => void | Promise<void>,
  onError: (error: unknown) => void,
  options?: { openFirstViewable?: boolean },
): boolean {
  const snapshot = snapshotOsFileDrop(event);
  if (!snapshotLooksLikeOsImport(snapshot)) return false;
  event.preventDefault();
  event.stopPropagation();
  void Promise.resolve(importSnapshot(parentPath, snapshot, options)).catch(onError);
  return true;
}

export function filesFromFileInput(fileList: FileList | null): DroppedImportFile[] {
  return Array.from(fileList ?? [])
    .map((file) => droppedFromFile(file))
    .filter((dropped): dropped is DroppedImportFile => dropped !== null);
}
