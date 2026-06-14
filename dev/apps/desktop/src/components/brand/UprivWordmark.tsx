import wordmarkNavy from "@assets/Upriv-wordmark-navy.svg";
import wordmarkWhite from "@assets/Upriv-wordmark-white.svg";
import { useAppSettingsContext } from "@/features/app-settings";
import { useTranslation } from "@/i18n";

interface UprivWordmarkProps {
  className?: string;
}

export function UprivWordmark({ className }: UprivWordmarkProps) {
  const { t } = useTranslation();
  const { settings } = useAppSettingsContext();
  const src = settings.ui.theme === "light" ? wordmarkNavy : wordmarkWhite;

  return <img src={src} alt={t("app.title")} className={className} />;
}
