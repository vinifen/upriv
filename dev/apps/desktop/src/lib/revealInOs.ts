import type { I18nKey } from "@/i18n";
import { desktopErrorI18nKey } from "./errorMessages";
import { isElectronRenderer } from "./invoke";

/** Runs a reveal RPC. Resolves to the toast key when it could not open, else `null`. */
export async function revealFailureKey(reveal: () => Promise<void>): Promise<I18nKey | null> {
  if (!isElectronRenderer()) return "modal.file_manager.toast.open_system_unavailable";
  try {
    await reveal();
    return null;
  } catch (error) {
    return desktopErrorI18nKey(error, "modal.file_manager.toast.open_system_failed");
  }
}
