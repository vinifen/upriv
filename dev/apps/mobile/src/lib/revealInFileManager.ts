import { Linking } from "react-native";
import { revealableLocation, RpcError } from "@upriv/shared";
import { getUprivCoreNative } from "upriv-core";

const OPEN_FAILED = "open_path_failed";

/**
 * Open an absolute OS path or `content://` tree in the system Files app.
 * Android uses the native module. iOS and Expo Go use a `file://` / `content://` URL.
 */
export async function revealInOsFileManager(osPath: string): Promise<void> {
  const location = revealableLocation(osPath);
  if (!location) {
    throw new RpcError(OPEN_FAILED, "path must be absolute");
  }
  const native = getUprivCoreNative();
  if (native && typeof native.revealInFileManager === "function") {
    try {
      native.revealInFileManager(location);
      return;
    } catch (error) {
      throw new RpcError(
        OPEN_FAILED,
        error instanceof Error ? error.message : "could not open file manager",
      );
    }
  }
  const fileUrl =
    location.startsWith("file://") || location.startsWith("content://")
      ? location
      : `file://${encodeURI(location)}`;
  try {
    const canOpen = await Linking.canOpenURL(fileUrl);
    if (canOpen) {
      await Linking.openURL(fileUrl);
      return;
    }
  } catch (error) {
    throw new RpcError(
      OPEN_FAILED,
      error instanceof Error ? error.message : "could not open file manager",
    );
  }
  throw new RpcError(OPEN_FAILED, "no system file manager");
}
