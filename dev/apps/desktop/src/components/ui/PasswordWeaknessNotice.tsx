import { PASSWORD_WEAKNESS_I18N_KEYS, type PasswordWeakness } from "@upriv/shared";
import { useTranslation } from "@/i18n";

interface PasswordWeaknessNoticeProps {
  /** `null` when nothing is wrong: the line goes away. */
  weakness: PasswordWeakness | null;
  /** Lets the password field point at the notice (`aria-describedby`). */
  id?: string;
}

/** One line under a new password saying what is objectively wrong with it. It never blocks. */
export function PasswordWeaknessNotice({ weakness, id }: PasswordWeaknessNoticeProps) {
  const { t } = useTranslation();
  return (
    <div id={id} aria-live="polite" className="empty:hidden">
      {weakness ? (
        <p className="text-xs text-on-error-container">
          {t(PASSWORD_WEAKNESS_I18N_KEYS[weakness])}
        </p>
      ) : null}
    </div>
  );
}
