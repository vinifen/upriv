import { useEffect, useRef, useState } from "react";
import { normalizeVaultListSearch } from "@upriv/shared";
import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";

interface VaultListSearchProps {
  value: string;
  onChange: (next: string) => void;
}

/** Magnifier that expands into a search field only while focused. */
export function VaultListSearch({ value, onChange }: VaultListSearchProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const hasQuery = value.trim().length > 0;
  const label = t("vault.list.search.label");
  const placeholder = t("vault.list.search.placeholder");
  const showHint = open && !hasQuery;

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (!root || root.contains(event.target as Node)) return;
      inputRef.current?.blur();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div
      ref={rootRef}
      role={open ? undefined : "button"}
      tabIndex={open ? undefined : 0}
      aria-label={open ? undefined : label}
      aria-pressed={open ? undefined : hasQuery}
      title={open ? undefined : label}
      className={[
        "flex h-[var(--control-height-md)] min-w-0 flex-1 items-center overflow-hidden rounded-xl border border-outline-variant",
        "transition-[max-width,padding] duration-200 ease-out motion-reduce:transition-none",
        open
          ? "max-w-xs gap-1.5 px-2"
          : "max-w-[var(--control-width-chrome)] cursor-pointer justify-center px-0 hover:bg-surface-container-high",
      ].join(" ")}
      onClick={open ? undefined : () => setOpen(true)}
      onKeyDown={
        open
          ? undefined
          : (event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              setOpen(true);
            }
      }
    >
      <Icon
        name="search"
        size={20}
        className={["shrink-0", !open && hasQuery ? "text-accent" : "text-on-surface-variant"].join(
          " ",
        )}
        aria-hidden
      />
      <div
        className={[
          "relative h-10 min-w-0 overflow-hidden",
          open ? "min-w-0 flex-1" : "w-0 flex-none",
        ].join(" ")}
      >
        {showHint ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm leading-10 text-on-surface-variant/70"
          >
            {placeholder}
          </span>
        ) : null}
        <input
          ref={inputRef}
          type="text"
          inputMode="search"
          value={value}
          tabIndex={open ? 0 : -1}
          onChange={(event) => onChange(normalizeVaultListSearch(event.target.value))}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            const trimmed = value.trim();
            if (trimmed !== value) onChange(trimmed);
            setOpen(false);
          }}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          aria-hidden={!open}
          aria-label={label}
          className={[
            "relative h-10 w-full min-w-0 bg-transparent py-0 text-sm leading-10 text-on-surface outline-none",
            "overflow-hidden whitespace-nowrap [field-sizing:fixed]",
            "transition-opacity duration-150 ease-out motion-reduce:transition-none",
            open ? "opacity-100" : "opacity-0 pointer-events-none",
          ].join(" ")}
        />
      </div>
    </div>
  );
}
