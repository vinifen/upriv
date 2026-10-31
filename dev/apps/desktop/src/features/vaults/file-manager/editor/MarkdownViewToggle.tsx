import type { MarkdownViewMode } from "@upriv/shared";
import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";

interface MarkdownViewToggleProps {
  mode: MarkdownViewMode;
  onChange: (mode: MarkdownViewMode) => void;
}

/** Single button toggle between Code (source) and Read (preview) markdown view. */
export function MarkdownViewToggle({ mode, onChange }: MarkdownViewToggleProps) {
  const { t } = useTranslation();

  const isPreview = mode === "preview";
  const label = t("modal.file_manager.markdown.view");
  const nextMode: MarkdownViewMode = isPreview ? "source" : "preview";
  const title = `${t("modal.file_manager.markdown.source")} / ${t("modal.file_manager.markdown.preview")}`;

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={isPreview}
      title={title}
      onClick={() => onChange(nextMode)}
      className={[
        "group flex h-6 shrink-0 items-center gap-0.5 rounded-full border border-outline-variant/70 bg-surface-container-highest/30 p-0.5 transition-colors",
        "hover:border-outline-variant focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
      ].join(" ")}
    >
      <span
        className={[
          "flex h-4.5 w-5 items-center justify-center rounded-full transition-colors",
          mode === "source"
            ? "bg-surface-container-highest text-on-surface shadow-xs"
            : "text-on-surface-variant/50 group-hover:text-on-surface-variant/80 hover:!text-on-surface",
        ].join(" ")}
        title={t("modal.file_manager.markdown.source")}
      >
        <Icon name="code" size={13} />
      </span>
      <span
        className={[
          "flex h-4.5 w-5 items-center justify-center rounded-full transition-colors",
          mode === "preview"
            ? "bg-surface-container-highest text-on-surface shadow-xs"
            : "text-on-surface-variant/50 group-hover:text-on-surface-variant/80 hover:!text-on-surface",
        ].join(" ")}
        title={t("modal.file_manager.markdown.preview")}
      >
        <Icon name="eye" size={13} />
      </span>
    </button>
  );
}
