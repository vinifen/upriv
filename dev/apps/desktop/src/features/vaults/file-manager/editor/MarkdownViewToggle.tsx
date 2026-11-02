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
        "group flex h-6 shrink-0 items-center gap-0.5 rounded-full p-0.5",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
      ].join(" ")}
    >
      <span
        className={segmentClass(mode === "source")}
        title={t("modal.file_manager.markdown.source")}
      >
        <Icon name="code" size={13} />
      </span>
      <span
        className={segmentClass(mode === "preview")}
        title={t("modal.file_manager.markdown.preview")}
      >
        <Icon name="eye" size={13} />
      </span>
    </button>
  );
}

/** Same fills as the path-bar toggles beside it: the click switches to the other side. */
function segmentClass(active: boolean): string {
  return [
    "flex h-4.5 w-5 items-center justify-center rounded-full transition-colors",
    active
      ? "bg-surface-container-highest text-on-surface"
      : "text-on-surface-variant group-hover:bg-surface-container-highest/60 group-hover:text-on-surface",
  ].join(" ");
}
