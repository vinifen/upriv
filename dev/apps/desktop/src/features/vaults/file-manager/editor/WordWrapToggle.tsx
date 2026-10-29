import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";

/** Path-bar button: toggles editor word wrap on/off (Alt+Z). */
export function WordWrapToggle({
  wrap,
  onChange,
}: {
  wrap: boolean;
  onChange: (wrap: boolean) => void;
}) {
  const { t } = useTranslation();
  const label = t(
    wrap
      ? "modal.file_manager.viewer.word_wrap_disable"
      : "modal.file_manager.viewer.word_wrap_enable",
  );
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={wrap}
      title={label}
      onClick={() => onChange(!wrap)}
      className={[
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        wrap
          ? "bg-surface-container-highest text-on-surface"
          : "text-on-surface-variant hover:bg-surface-container-highest/60 hover:text-on-surface",
      ].join(" ")}
    >
      <Icon name="wrap-text" size={14} />
    </button>
  );
}
