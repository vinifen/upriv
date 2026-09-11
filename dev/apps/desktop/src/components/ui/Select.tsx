import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "@/components/icons";
import { AnchoredPopover } from "./AnchoredPopover";

export type SelectOptionTone = "default" | "muted" | "danger";

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
  tone?: SelectOptionTone;
}

interface SelectProps<T extends string | number> {
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  id?: string;
  /** Accessible name when the visible label is elsewhere (`SettingsField`). */
  "aria-label"?: string;
  size?: "sm" | "md";
  className?: string;
}

/** Custom picker — native `<select>` is too OS-default for settings/modals. */
const SELECT_Z_INDEX = 250;

function optionToneClass(
  tone: SelectOptionTone | undefined,
  selected: boolean,
  active: boolean,
): string {
  if (tone === "danger") {
    if (selected) {
      return "bg-[color-mix(in_srgb,var(--on-error-container)_16%,transparent)] font-medium text-on-error-container";
    }
    return active
      ? "bg-[color-mix(in_srgb,var(--on-error-container)_10%,transparent)] text-on-error-container"
      : "text-on-error-container hover:bg-[color-mix(in_srgb,var(--on-error-container)_10%,transparent)]";
  }
  if (tone === "muted") {
    if (selected) return "font-medium text-on-surface-variant";
    return active
      ? "bg-[color-mix(in_srgb,var(--on-surface)_8%,transparent)] text-on-surface-variant"
      : "text-on-surface-variant hover:bg-[color-mix(in_srgb,var(--on-surface)_8%,transparent)]";
  }
  if (selected) {
    return "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] font-medium text-on-surface";
  }
  return active
    ? "bg-[color-mix(in_srgb,var(--on-surface)_8%,transparent)] text-on-surface"
    : "text-on-surface hover:bg-[color-mix(in_srgb,var(--on-surface)_8%,transparent)]";
}

function indexOfValue<T extends string | number>(
  options: readonly SelectOption<T>[],
  value: T,
): number {
  const index = options.findIndex((option) => option.value === value);
  return index < 0 ? 0 : index;
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
  id,
  "aria-label": ariaLabel,
  size = "md",
  className,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [menuSide, setMenuSide] = useState<"below" | "above">("below");
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const selectedLabel = useMemo(
    () => options.find((option) => option.value === value)?.label ?? String(value),
    [options, value],
  );
  const compact = size === "sm";
  const name = ariaLabel ?? selectedLabel;
  const attachedBelow = open && menuSide === "below";
  const attachedAbove = open && menuSide === "above";
  const activeId = open && options[activeIndex] ? `${listId}-opt-${activeIndex}` : undefined;

  const close = useCallback(() => {
    setOpen(false);
    setMenuSide("below");
  }, []);

  const openList = useCallback((index: number) => {
    setActiveIndex(index);
    setOpen(true);
  }, []);

  const pick = useCallback(
    (next: T) => {
      onChange(next);
      close();
    },
    [close, onChange],
  );

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || options.length === 0) return;
    const last = options.length - 1;
    const selected = indexOfValue(options, value);

    const move = (next: number) => {
      event.preventDefault();
      const clamped = Math.max(0, Math.min(last, next));
      if (!open) {
        openList(clamped);
        return;
      }
      setActiveIndex(clamped);
      queueMicrotask(() => {
        document.getElementById(`${listId}-opt-${clamped}`)?.scrollIntoView({ block: "nearest" });
      });
    };

    switch (event.key) {
      case "ArrowDown":
        move(open ? activeIndex + 1 : selected);
        break;
      case "ArrowUp":
        move(open ? activeIndex - 1 : selected);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(last);
        break;
      case "Enter":
      case " ":
        if (!open) return;
        event.preventDefault();
        event.stopPropagation();
        pick(options[activeIndex]!.value);
        break;
      default:
        break;
    }
  };

  return (
    <div
      className={[
        compact ? "relative inline-grid max-w-[16rem] shrink-0" : "relative grid min-w-0 w-full",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {compact
        ? options.map((option) => (
            <span
              key={`sizer-${String(option.value)}`}
              aria-hidden
              className="pointer-events-none invisible col-start-1 row-start-1 flex h-10 w-max items-center px-1 pr-2 text-xs sm:text-sm"
            >
              <span className="flex items-center gap-2 px-2.5">
                <span className="shrink-0 whitespace-nowrap">{option.label}</span>
                <span className="w-4 shrink-0" />
              </span>
            </span>
          ))
        : null}
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={activeId}
        aria-label={name}
        onClick={() => {
          if (disabled) return;
          if (open) {
            close();
            return;
          }
          openList(indexOfValue(options, value));
        }}
        onKeyDown={onTriggerKeyDown}
        className={[
          "col-start-1 row-start-1 flex w-full items-center gap-2 border-0 bg-surface-container-highest text-left text-on-surface outline-none",
          "ring-0 focus-visible:ring-2 focus-visible:ring-accent/40",
          open ? "focus-visible:ring-0" : "",
          "disabled:cursor-not-allowed disabled:opacity-60",
          compact
            ? "h-10 px-3 text-xs sm:text-sm"
            : "min-h-11 min-w-0 px-3.5 py-2.5 text-sm sm:min-h-12 sm:px-4",
          attachedBelow
            ? "rounded-t-xl rounded-b-none"
            : attachedAbove
              ? "rounded-b-xl rounded-t-none"
              : "rounded-xl",
        ].join(" ")}
      >
        <span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
        <Icon
          name="chevron-down"
          size={compact ? 14 : 16}
          className="shrink-0 text-on-surface-variant"
          aria-hidden
        />
      </button>
      <AnchoredPopover
        open={open}
        onClose={close}
        triggerRef={triggerRef}
        align={compact ? "right" : "left"}
        matchTriggerWidth
        gap={-1}
        id={listId}
        role="listbox"
        aria-label={name}
        zIndex={SELECT_Z_INDEX}
        onSideChange={setMenuSide}
        className={[
          "select-scroll-pane h-fit border-0 bg-surface-container-highest outline-none ring-0",
          "py-1",
          attachedBelow
            ? "rounded-t-none rounded-b-xl shadow-[0_12px_24px_-4px_rgb(0_0_0_/_0.4)] [clip-path:inset(0_-32px_-32px_-32px)]"
            : "rounded-b-none rounded-t-xl shadow-[0_-12px_24px_-4px_rgb(0_0_0_/_0.4)] [clip-path:inset(-32px_-32px_0_-32px)]",
        ].join(" ")}
      >
        <ul className={compact ? "px-1" : "px-1.5"} role="none">
          {options.map((option, index) => {
            const selected = option.value === value;
            const active = index === activeIndex;
            return (
              <li key={String(option.value)} role="none">
                <button
                  type="button"
                  id={`${listId}-opt-${index}`}
                  role="option"
                  tabIndex={-1}
                  aria-selected={selected}
                  className={[
                    "flex w-full items-center rounded-lg text-left transition-colors",
                    compact ? "gap-2 px-2.5 py-2 text-xs sm:text-sm" : "gap-3 px-3.5 py-3 text-sm",
                    optionToneClass(option.tone, selected, active),
                  ].join(" ")}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => pick(option.value)}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  <span
                    aria-hidden
                    className={[
                      "w-4 shrink-0 font-mono text-xs",
                      selected ? "text-vault-open" : "text-transparent",
                    ].join(" ")}
                  >
                    ✓
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </AnchoredPopover>
    </div>
  );
}
