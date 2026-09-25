import { VAULT_FS_INLINE_CHUNK_BYTES, type VaultBinaryByteSource } from "@upriv/shared";

function blobSliceBytes(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  const part = blob.slice(start, end);
  if (typeof part.arrayBuffer === "function") {
    return part.arrayBuffer().then((buf) => new Uint8Array(buf));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsArrayBuffer(part);
  });
}

export function blobBinarySource(blob: Blob): VaultBinaryByteSource {
  return {
    size: blob.size,
    slice: (start, end) => blobSliceBytes(blob, start, end),
  };
}

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function osPathBinarySource(osPath: string, size: number): VaultBinaryByteSource {
  return {
    size,
    slice: async (start, end) => {
      const api = window.upriv;
      if (!api || typeof api.readDroppedPathRange !== "function") {
        throw new Error("read failed");
      }
      const len = Math.min(Math.max(0, end - start), VAULT_FS_INLINE_CHUNK_BYTES);
      const row = await api.readDroppedPathRange(osPath, start, len);
      return b64ToBytes(row.contentB64);
    },
  };
}

export function binarySourceFromDropped(
  file: File,
  osPath?: string,
  byteSize?: number,
): VaultBinaryByteSource {
  if (osPath && byteSize != null && byteSize > 0) return osPathBinarySource(osPath, byteSize);
  if (file.size > 0) return blobBinarySource(file);
  return {
    size: 0,
    slice: async () => new Uint8Array(),
  };
}
