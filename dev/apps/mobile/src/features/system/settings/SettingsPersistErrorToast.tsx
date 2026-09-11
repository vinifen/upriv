import { useEffect } from "react";
import { Toast } from "@/components/ui/Toast";
import { useToast } from "@upriv/shared/react";
import { useTranslation, type I18nKey } from "@/i18n";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import { useAppSettingsContext } from "./AppSettingsContext";

/** Must render under ThemeProvider (Toast uses useTheme). */
export function SettingsPersistErrorToast() {
  const { persistErrorSignal, persistError } = useAppSettingsContext();
  const { t } = useTranslation();
  const { message, show, dismiss } = useToast();

  useEffect(() => {
    if (persistErrorSignal === 0) return;
    const key = mobileErrorI18nKey(persistError, "toast.settings_save_failed" as I18nKey);
    show(t(key));
  }, [persistError, persistErrorSignal, show, t]);

  return <Toast message={message} onDismiss={dismiss} />;
}
