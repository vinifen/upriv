import { useTranslation } from "@/i18n";

interface VaultPasswordHintCalloutProps {
  hint: string;
}

export function VaultPasswordHintCallout({ hint }: VaultPasswordHintCalloutProps) {
  const { t } = useTranslation();

  return (
    <p className="text-sm leading-relaxed text-on-surface-variant">
      <span className="font-medium text-on-surface">{t("unlock.password_hint_label")}: </span>
      {hint}
    </p>
  );
}
