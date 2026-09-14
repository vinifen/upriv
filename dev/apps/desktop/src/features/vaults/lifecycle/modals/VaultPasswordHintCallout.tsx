import { useTranslation } from "@/i18n";

interface VaultPasswordHintCalloutProps {
  hint: string;
}

/** Quiet reminder under the unlock field — never competes with the Password label. */
export function VaultPasswordHintCallout({ hint }: VaultPasswordHintCalloutProps) {
  const { t } = useTranslation();

  return (
    <p className="text-xs leading-snug text-on-surface-variant">
      {t("unlock.password_hint_label")} · {hint}
    </p>
  );
}
