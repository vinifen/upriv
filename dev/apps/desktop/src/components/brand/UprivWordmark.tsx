import wordmarkNavy from "@assets/Upriv-wordmark-navy.svg";
import wordmarkWhite from "@assets/Upriv-wordmark-white.svg";
import type { UiTheme } from "@upriv/shared";
import { useTranslation } from "@/i18n";

interface UprivWordmarkProps {
  className?: string;
  theme: UiTheme;
}

export function UprivWordmark({ className, theme }: UprivWordmarkProps) {
  const { t } = useTranslation();
  const src = theme === "light" ? wordmarkNavy : wordmarkWhite;

  return <img src={src} alt={t("app.title")} className={className} />;
}
