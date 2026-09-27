/** Node stand-in for `expo-file-system`. Native module install is not available in Vitest. */
export const cacheDirectory = "file:///tmp/upriv-cache/";

export const EncodingType = {
  UTF8: "utf8",
  Base64: "base64",
} as const;

export async function deleteAsync(): Promise<void> {}

export async function getInfoAsync(): Promise<{ exists: boolean; isDirectory: boolean }> {
  return { exists: false, isDirectory: false };
}

export async function readAsStringAsync(): Promise<string> {
  return "";
}

export const StorageAccessFramework = {
  async readDirectoryAsync(): Promise<string[]> {
    return [];
  },
  async requestDirectoryPermissionsAsync(): Promise<{ granted: boolean; directoryUri: string }> {
    return { granted: false, directoryUri: "" };
  },
};
