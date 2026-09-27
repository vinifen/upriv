import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Keep in sync with `upriv-core` `VAULT_FS_MAX_INLINE_BYTES`. */
const MAX_FILE_BYTES = 4 * 1024 * 1024;
/** Cap for the path that reads file bytes into this process. */
const CONTENT_MAX_FILES = 200;
const MAX_DEPTH = 12;
const SKIP_NAMES = new Set([".upriv-workspace.json", "upriv-seed.txt"]);
/** Leave at least this much RAM for the OS and the vault process. */
const MIN_MEMORY_RESERVE_BYTES = 256 * 1024 * 1024;

export type DroppedContentResult = {
  files: DroppedImportPayload[];
  /** True when the byte-reading walk stopped before every file. */
  truncated: boolean;
  /** A symlink was in the tree. `files` is empty; the import must not continue. */
  symlinks: string[];
};

export type DroppedImportPayload = {
  relativePath: string;
  contentB64: string;
};

export type DroppedImportStat = {
  relativePath: string;
  osPath: string;
  size: number;
};

/**
 * Read user-dropped OS files/folders into RAM (no temp extract).
 * Stops at `CONTENT_MAX_FILES` because each file's bytes are held here.
 * A symlink refuses the import. The final component is opened without following it.
 */
export async function readDroppedImportPaths(inputPaths: unknown): Promise<DroppedContentResult> {
  if (!Array.isArray(inputPaths)) return { files: [], truncated: false, symlinks: [] };
  const out: DroppedImportPayload[] = [];
  let truncated = false;
  const found = { symlink: null as string | null };
  for (const raw of inputPaths) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const abs = path.resolve(trimmed);
    if (!path.isAbsolute(abs)) continue;
    if (out.length >= CONTENT_MAX_FILES) {
      truncated = true;
      break;
    }
    truncated = (await walkDroppedPath(abs, path.basename(abs), 0, out, found)) || truncated;
    if (found.symlink) {
      return { files: [], truncated: false, symlinks: [found.symlink] };
    }
    if (truncated) break;
  }
  return { files: out, truncated, symlinks: [] };
}

export type DroppedImportStatResult = {
  files: DroppedImportStat[];
  /** Roots whose `lstat` failed. An empty directory is readable and stays out of this list. */
  unreadable: string[];
  /** True when free memory or depth stopped the walk before every file was listed. */
  truncated: boolean;
  /** A symlink was in the tree. `files` is empty; the import must not continue. */
  symlinks: string[];
};

type StatBudget = {
  files: DroppedImportStat[];
  /** One in-process copy of the path list. The renderer clones it again over IPC. */
  retainedBytes: number;
  truncated: boolean;
};

/** Bytes for one path pair in one heap (UTF-16 strings plus a small object). */
function statEntryBytes(relativePath: string, osPath: string): number {
  return (relativePath.length + osPath.length) * 2 + 192;
}

function memoryCeilingBytes(): number {
  const total = os.totalmem();
  const constrained = (
    process as NodeJS.Process & { constrainedMemory?: () => number | undefined }
  ).constrainedMemory?.();
  // Unconstrained Linux cgroups report a uint64 max. Ignore anything above the machine.
  if (
    typeof constrained === "number" &&
    Number.isFinite(constrained) &&
    constrained > 0 &&
    constrained <= total
  ) {
    return constrained;
  }
  return total;
}

function freeMemoryBytes(): number {
  const available = (
    process as NodeJS.Process & { availableMemory?: () => number | undefined }
  ).availableMemory?.();
  if (typeof available === "number" && Number.isFinite(available) && available >= 0) {
    return available;
  }
  return os.freemem();
}

/**
 * True when this process can store `incomingBytes` now and the renderer can
 * clone the whole list later, while leaving a reserve for the OS and the vault.
 */
export function statListFitsInFreeMemory(
  retainedBytes: number,
  incomingBytes: number,
  freeBytes: number,
  ceilingBytes: number,
): boolean {
  const preferred = Math.max(MIN_MEMORY_RESERVE_BYTES, Math.floor(ceilingBytes * 0.15));
  const reserve = ceilingBytes < preferred ? Math.floor(ceilingBytes * 0.25) : preferred;
  // Main process holds the list, and IPC clones that whole list into the renderer.
  const bothCopies = (retainedBytes + incomingBytes) * 2;
  return freeBytes >= reserve + bothCopies;
}

function canAppendStat(budget: StatBudget, relativePath: string, osPath: string): boolean {
  const incoming = statEntryBytes(relativePath, osPath);
  return statListFitsInFreeMemory(
    budget.retainedBytes,
    incoming,
    freeMemoryBytes(),
    memoryCeilingBytes(),
  );
}

export type DroppedPathKind = "file" | "directory" | "other";

/**
 * `lstat` one dropped path. Does not follow symlinks, walk a folder, or
 * resolve a relative path against this process's cwd.
 */
export async function classifyDroppedPath(input: unknown): Promise<DroppedPathKind> {
  if (typeof input !== "string") return "other";
  const trimmed = input.trim();
  if (!path.isAbsolute(trimmed)) return "other";
  try {
    const st = await fs.lstat(trimmed);
    if (st.isSymbolicLink()) return "other";
    if (st.isDirectory()) return "directory";
    if (st.isFile()) return "file";
    return "other";
  } catch {
    return "other";
  }
}

/**
 * List dropped files as path + size only. File bytes stay on disk.
 * Stops when the path list would crowd out the reserve, or when a directory
 * is deeper than `MAX_DEPTH`. A symlink refuses the listing.
 */
export async function statDroppedImportPaths(
  inputPaths: unknown,
): Promise<DroppedImportStatResult> {
  if (!Array.isArray(inputPaths)) {
    return { files: [], unreadable: [], truncated: false, symlinks: [] };
  }
  const budget: StatBudget = { files: [], retainedBytes: 0, truncated: false };
  const unreadable: string[] = [];
  const found = { symlink: null as string | null };
  for (const raw of inputPaths) {
    if (budget.truncated) break;
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const abs = path.resolve(trimmed);
    if (!path.isAbsolute(abs)) continue;
    const status = await walkDroppedStats(abs, path.basename(abs), 0, budget, found);
    if (status === "symlink" && found.symlink) {
      return { files: [], unreadable, truncated: false, symlinks: [found.symlink] };
    }
    if (status === "unreadable") unreadable.push(abs);
  }
  return { files: budget.files, unreadable, truncated: budget.truncated, symlinks: [] };
}

export async function readDroppedPathRange(
  osPath: unknown,
  offset: unknown,
  len: unknown,
): Promise<{ contentB64: string }> {
  if (typeof osPath !== "string" || typeof offset !== "number" || typeof len !== "number") {
    return { contentB64: "" };
  }
  const abs = path.resolve(osPath.trim());
  if (!path.isAbsolute(abs) || !Number.isFinite(offset) || !Number.isFinite(len)) {
    return { contentB64: "" };
  }
  const start = Math.max(0, Math.floor(offset));
  const want = Math.min(MAX_FILE_BYTES, Math.max(0, Math.floor(len)));
  if (want === 0) return { contentB64: "" };

  let st;
  try {
    st = await fs.lstat(abs);
  } catch {
    return { contentB64: "" };
  }
  if (st.isSymbolicLink()) throw new RefusingSymlinkError();
  if (!st.isFile()) return { contentB64: "" };

  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await openRegularNoFollow(abs, st);
    const buf = Buffer.alloc(want);
    const { bytesRead } = await handle.read(buf, 0, want, start);
    return { contentB64: buf.subarray(0, bytesRead).toString("base64") };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** The final path component is a symlink, or it was replaced by one before open. */
class RefusingSymlinkError extends Error {
  constructor() {
    super("refusing a symlink");
    this.name = "RefusingSymlinkError";
  }
}

/**
 * Open the final path component without following a symlink.
 * `O_NOFOLLOW` covers Unix. The `lstat`/`fstat` identity check covers a
 * replacement between the check and the open, including Windows.
 */
async function openRegularNoFollow(
  abs: string,
  st: Awaited<ReturnType<typeof fs.lstat>>,
): Promise<Awaited<ReturnType<typeof fs.open>>> {
  const nofollow = fsConstants.O_NOFOLLOW;
  const flags =
    typeof nofollow === "number" ? fsConstants.O_RDONLY | nofollow : fsConstants.O_RDONLY;
  let handle: Awaited<ReturnType<typeof fs.open>>;
  try {
    handle = await fs.open(abs, flags);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ELOOP") throw new RefusingSymlinkError();
    throw error;
  }
  try {
    const opened = await handle.stat();
    const followed = opened.dev !== st.dev || opened.ino !== st.ino;
    if (followed || opened.isSymbolicLink() || !opened.isFile()) {
      throw new RefusingSymlinkError();
    }
    return handle;
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

/** True when this walk stopped early and left files unlisted. */
async function walkDroppedPath(
  abs: string,
  relative: string,
  depth: number,
  out: DroppedImportPayload[],
  found: { symlink: string | null },
): Promise<boolean> {
  if (found.symlink) return true;
  if (out.length >= CONTENT_MAX_FILES) return true;
  if (depth > MAX_DEPTH) return true;
  if (SKIP_NAMES.has(path.basename(abs))) return false;

  let st;
  try {
    st = await fs.lstat(abs);
  } catch {
    return false;
  }
  if (st.isSymbolicLink()) {
    found.symlink = abs;
    return true;
  }

  if (st.isDirectory()) {
    let names: string[];
    try {
      names = await fs.readdir(abs);
    } catch {
      return true;
    }
    for (const name of names) {
      const stopped = await walkDroppedPath(
        path.join(abs, name),
        path.posix.join(relative, name),
        depth + 1,
        out,
        found,
      );
      if (stopped) return true;
    }
    return false;
  }

  if (!st.isFile() || st.size > MAX_FILE_BYTES) return false;

  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  let buf: Buffer;
  try {
    handle = await openRegularNoFollow(abs, st);
    buf = await handle.readFile();
  } catch (error) {
    if (error instanceof RefusingSymlinkError) {
      found.symlink = abs;
      return true;
    }
    return false;
  } finally {
    await handle?.close().catch(() => undefined);
  }
  out.push({
    relativePath: relative.replace(/\\/g, "/"),
    contentB64: buf.toString("base64"),
  });
  return false;
}

type WalkStatus = "ok" | "unreadable" | "stop" | "symlink";

async function walkDroppedStats(
  abs: string,
  relative: string,
  depth: number,
  budget: StatBudget,
  found: { symlink: string | null },
): Promise<WalkStatus> {
  if (budget.truncated) return "stop";
  if (depth > MAX_DEPTH) {
    budget.truncated = true;
    return "ok";
  }
  if (SKIP_NAMES.has(path.basename(abs))) return "ok";

  let st;
  try {
    st = await fs.lstat(abs);
  } catch {
    return "unreadable";
  }
  if (st.isSymbolicLink()) {
    found.symlink = abs;
    return "symlink";
  }

  if (st.isDirectory()) {
    if (
      !statListFitsInFreeMemory(budget.retainedBytes, 0, freeMemoryBytes(), memoryCeilingBytes())
    ) {
      budget.truncated = true;
      return "stop";
    }
    let names: string[];
    try {
      names = await fs.readdir(abs);
    } catch {
      budget.truncated = true;
      return "ok";
    }
    for (const name of names) {
      const status = await walkDroppedStats(
        path.join(abs, name),
        path.posix.join(relative, name),
        depth + 1,
        budget,
        found,
      );
      if (status === "symlink" || status === "stop") return status;
    }
    return "ok";
  }

  if (!st.isFile()) return "ok";
  const relativePath = relative.replace(/\\/g, "/");
  if (!canAppendStat(budget, relativePath, abs)) {
    budget.truncated = true;
    return "stop";
  }
  budget.files.push({ relativePath, osPath: abs, size: st.size });
  budget.retainedBytes += statEntryBytes(relativePath, abs);
  return "ok";
}
