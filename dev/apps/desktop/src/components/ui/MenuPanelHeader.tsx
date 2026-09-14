import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";

interface MenuPanelHeaderProps {
  title: string;
  onClose: () => void;
}

/** Title + close for small anchored menus — sized to the uppercase caption. */
export function MenuPanelHeader({ title, onClose }: MenuPanelHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-1 pl-4 pr-1.5 pt-0.5 pb-0.5">
      <p
        className="min-w-0 flex-1 truncate font-mono text-[10px] font-medium uppercase tracking-widest text-on-surface-variant"
        aria-hidden
      >
        {title}
      </p>
      <button
        type="button"
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border-0 bg-transparent p-0 leading-none text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container-high"
        aria-label={t("action.close")}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
      >
        <Icon name="close" size={12} className="block" />
      </button>
    </div>
  );
}
