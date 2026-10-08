import { Alert } from "react-native";
import type { VaultRootPrivateRoot } from "@upriv/shared";
import { isAndroidSharedDocumentsRoot } from "@/platform/native/documentsGrant";
import { safRelease } from "@/platform/native/safVaultRoot";

export type DocumentsUprivPick = { status: "picked"; uri: string } | { status: "cancelled" };

/**
 * Open the system picker on Documents. Confirming that folder is the whole
 * step — `Upriv` is created inside the grant. Cancel leaves the data folder
 * unchanged.
 */
export async function pickDocumentsUprivFolder(
  pickFolder: (initialUri: string | null, title: string) => Promise<string | null>,
  initialUri: string | null,
  title: string,
): Promise<DocumentsUprivPick> {
  const picked = (await pickFolder(initialUri, title))?.trim() ?? "";
  if (!picked) return { status: "cancelled" };
  return { status: "picked", uri: picked };
}

/** Drop a grant on the whole Documents directory. Returns true when `uri` was that directory. */
export function releaseIfDocumentsRoot(uri: string): boolean {
  if (!isAndroidSharedDocumentsRoot(uri)) return false;
  try {
    safRelease(uri);
  } catch {
    /* already gone */
  }
  return true;
}

export function alertIfPrivateRootLeftBehind(
  privateRoot: VaultRootPrivateRoot | undefined,
  title: string,
  body: string,
): void {
  if (privateRoot !== "left_behind") return;
  Alert.alert(title, body);
}
