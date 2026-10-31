import type { RefObject } from "react";
import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";

interface ExplorerSearchProps {
  inputRef: RefObject<HTMLInputElement>;
  query: string;
  onQueryChange: (query: string) => void;
  onClose: () => void;
}

/** Finds files and folders by name, at any depth of the vault. Escape clears, then closes. */
export function ExplorerSearch({ inputRef, query, onQueryChange, onClose }: ExplorerSearchProps) {
  const { t } = useTranslation();
  return (
    <div className="mx-1 mb-1 flex h-6 shrink-0 items-center gap-1 rounded bg-surface-container-highest px-1.5">
      <Icon name="search" size={12} className="shrink-0 text-on-surface-variant" aria-hidden />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          if (query) onQueryChange("");
          else onClose();
        }}
        placeholder={t("modal.file_manager.explorer.search_placeholder")}
        aria-label={t("modal.file_manager.explorer.search_placeholder")}
        autoComplete="off"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-xs text-on-surface outline-none placeholder:text-on-surface-variant"
      />
      {query ? (
        <button
          type="button"
          onClick={() => onQueryChange("")}
          aria-label={t("modal.file_manager.explorer.search_clear")}
          title={t("modal.file_manager.explorer.search_clear")}
          className="flex shrink-0 items-center justify-center rounded text-on-surface-variant transition-colors hover:text-on-surface"
        >
          <Icon name="close" size={11} />
        </button>
      ) : null}
    </div>
  );
}
