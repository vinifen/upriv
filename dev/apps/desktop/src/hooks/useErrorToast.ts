import { useCallback } from "react";
import { useTranslation } from "@/i18n";
import type { I18nKey } from "@/i18n";
import { desktopErrorI18nKey } from "@/lib/errorMessages";
import { useToast, TOAST_DEFAULT_MS } from "./useToast";

/** Toast + translated user-facing errors (`showError(error, fallbackKey)`). */
export function useErrorToast(defaultMs: number = TOAST_DEFAULT_MS) {
  const { t } = useTranslation();
  const { message, show, dismiss } = useToast(defaultMs);

  const showError = useCallback(
    (error: unknown, fallback: I18nKey = "error.unexpected") => {
      show(t(desktopErrorI18nKey(error, fallback)));
    },
    [show, t],
  );

  const errorText = useCallback(
    (error: unknown, fallback: I18nKey) => t(desktopErrorI18nKey(error, fallback)),
    [t],
  );

  return { message, show, showError, errorText, dismiss, t };
}
