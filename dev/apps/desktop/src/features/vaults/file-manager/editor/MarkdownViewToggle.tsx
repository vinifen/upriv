import type { MarkdownViewMode } from "@upriv/shared";
import { Icon, type IconName } from "@/components/icons";
import { useTranslation, type I18nKey } from "@/i18n";

interface MarkdownViewToggleProps {
  mode: MarkdownViewMode;
  onChange: (mode: MarkdownViewMode) => void;
}

const VIEWS: readonly { mode: MarkdownViewMode; icon: IconName; label: I18nKey }[] = [
  { mode: "source", icon: "code", label: "modal.file_manager.markdown.source" },
  { mode: "preview", icon: "eye", label: "modal.file_manager.markdown.preview" },
];

/**
 * Code and Read, each its own button: a click on the other view picks it, and
 * a click on the view in use switches to the other one. The view in use wears
 * the fill of the path-bar toggles beside it; the other is muted.
 */
export function MarkdownViewToggle({ mode, onChange }: MarkdownViewToggleProps) {
  const { t } = useTranslation();
  const other: MarkdownViewMode = mode === "preview" ? "source" : "preview";
  return (
    <div role="group" aria-label={t("modal.file_manager.markdown.view")} className="flex gap-2">
      {VIEWS.map((view) => {
        const selected = view.mode === mode;
        const label = t(view.label);
        return (
          <button
            key={view.mode}
            type="button"
            aria-label={label}
            aria-pressed={selected}
            title={label}
            onClick={() => onChange(selected ? other : view.mode)}
            className={[
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              selected
                ? "bg-surface-container-highest text-on-surface"
                : "text-on-surface-variant/60 hover:bg-surface-container-highest/60 hover:text-on-surface",
            ].join(" ")}
          >
            <Icon name={view.icon} size={14} />
          </button>
        );
      })}
    </div>
  );
}
