import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";

export interface FileEditorSearchHandle {
  focus: () => void;
}

export interface FileEditorSearchProps {
  query: string;
  totalMatches: number;
  activeMatchIndex: number;
  onQueryChange: (query: string) => void;
  onNextMatch: () => void;
  onPrevMatch: () => void;
}

/** In-file search field displayed in the EditorPathBar row. Remains open while focused. */
export const FileEditorSearch = forwardRef<FileEditorSearchHandle, FileEditorSearchProps>(
  function FileEditorSearch(
    { query, totalMatches, activeMatchIndex, onQueryChange, onNextMatch, onPrevMatch },
    ref,
  ) {
    const { t } = useTranslation();
    const rootRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const [focusedOpen, setFocusedOpen] = useState(false);
    const hasQuery = query.trim().length > 0;
    const isOpen = hasQuery || focusedOpen;

    /** Show the field, then focus it once it has rendered. */
    const openAndFocus = () => {
      setFocusedOpen(true);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    };

    useImperativeHandle(ref, () => ({ focus: openAndFocus }));

    useEffect(() => {
      if (!focusedOpen) return;
      const onPointerDown = (event: PointerEvent) => {
        const root = rootRef.current;
        if (!root || root.contains(event.target as Node)) return;
        setFocusedOpen(false);
      };
      document.addEventListener("pointerdown", onPointerDown);
      return () => document.removeEventListener("pointerdown", onPointerDown);
    }, [focusedOpen]);

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (event.shiftKey) {
          onPrevMatch();
        } else {
          onNextMatch();
        }
      } else if (
        event.key === "ArrowDown" &&
        !event.shiftKey &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        event.preventDefault();
        onNextMatch();
      } else if (
        event.key === "ArrowUp" &&
        !event.shiftKey &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        event.preventDefault();
        onPrevMatch();
      } else if (event.key === "Escape") {
        event.preventDefault();
        onQueryChange("");
        setFocusedOpen(false);
        inputRef.current?.blur();
      }
    };

    if (!isOpen) {
      const label = t("modal.file_manager.search.open");
      return (
        <button
          type="button"
          aria-label={label}
          title={label}
          onClick={openAndFocus}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-highest/60 hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Icon name="search" size={13} />
        </button>
      );
    }

    const safeActiveIndex = totalMatches > 0 ? Math.min(activeMatchIndex, totalMatches - 1) : 0;
    const matchLabel =
      hasQuery && totalMatches > 0 ? `${safeActiveIndex + 1}/${totalMatches}` : hasQuery ? "∅" : "";

    return (
      <div
        ref={rootRef}
        role="search"
        aria-label={t("modal.file_manager.search.placeholder")}
        className="flex h-6 shrink-0 items-center gap-1 rounded-md border border-outline-variant/70 bg-surface-container-highest px-1.5 text-[11px] leading-none transition-all"
      >
        <Icon
          name="search"
          size={12}
          className={["shrink-0", hasQuery ? "text-accent" : "text-on-surface-variant"].join(" ")}
          aria-hidden
        />
        <input
          ref={inputRef}
          type="text"
          spellCheck={false}
          autoComplete="off"
          value={query}
          placeholder={t("modal.file_manager.search.placeholder")}
          onFocus={() => setFocusedOpen(true)}
          onBlur={(event) => {
            if (!rootRef.current?.contains(event.relatedTarget as Node)) {
              setFocusedOpen(false);
            }
          }}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={handleKeyDown}
          className="h-full w-24 bg-transparent text-[11px] leading-5 text-on-surface outline-none placeholder:text-on-surface-variant/60 sm:w-32"
        />
        {matchLabel ? (
          <span
            aria-live="polite"
            title={totalMatches === 0 ? t("modal.file_manager.search.no_matches") : undefined}
            className="shrink-0 select-none px-0.5 text-[10px] tabular-nums text-on-surface-variant"
          >
            {matchLabel}
          </span>
        ) : null}
        <button
          type="button"
          aria-label={t("modal.file_manager.search.prev")}
          title={t("modal.file_manager.search.prev")}
          disabled={totalMatches === 0}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onPrevMatch}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface disabled:pointer-events-none disabled:opacity-30"
        >
          <Icon name="arrow-up" size={10} />
        </button>
        <button
          type="button"
          aria-label={t("modal.file_manager.search.next")}
          title={t("modal.file_manager.search.next")}
          disabled={totalMatches === 0}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onNextMatch}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface disabled:pointer-events-none disabled:opacity-30"
        >
          <Icon name="arrow-down" size={10} />
        </button>
      </div>
    );
  },
);
