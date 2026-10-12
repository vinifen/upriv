import type { MarkdownViewMode } from "@upriv/shared";
import { useTranslation } from "@/i18n";

interface MarkdownViewToggleProps {
  mode: MarkdownViewMode;
  onChange: (mode: MarkdownViewMode) => void;
}

const OPTIONS: MarkdownViewMode[] = ["source", "preview"];

/** Vault-wide Code / Read control. The choice is stored on the workspace file. */
export function MarkdownViewToggle({ mode, onChange }: MarkdownViewToggleProps) {
  const { t } = useTranslation();

  return (
    <div
      role="group"
      aria-label={t("modal.file_manager.markdown.view")}
      className="flex shrink-0 items-center gap-1"
    >
      {OPTIONS.map((option) => {
        const selected = mode === option;
        const label =
          option === "preview"
            ? t("modal.file_manager.markdown.preview")
            : t("modal.file_manager.markdown.source");
        return (
          <button
            key={option}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option)}
            className={[
              "min-w-[4rem] rounded-full px-3.5 py-0.5 text-center text-[11px] leading-4 font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              selected
                ? "bg-surface-container-highest text-on-surface"
                : "text-on-surface-variant hover:bg-surface-container-highest/60 hover:text-on-surface",
            ].join(" ")}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
