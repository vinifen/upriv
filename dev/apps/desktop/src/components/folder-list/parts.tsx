import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import { Button, DropdownMenu, IconButton, type DropdownMenuItem } from "@/components/ui";
import { useTranslation, type I18nKey } from "@/i18n";

/** A row's card: the accent border when selected, the attention border while it misses a step. */
export function rowCardClass(checked: boolean, attention: boolean): string {
  const border = attention
    ? "border-2 border-[var(--vault-status-recovery)]"
    : checked
      ? "border-2 border-[var(--accent)]"
      : "border border-outline-variant";
  return ["rounded-xl bg-surface-container p-2.5 transition-colors sm:p-3", border].join(" ");
}

/** Where what belongs to a row starts under it: past the radio, under its text. */
export const ROW_INSET_CLASS = "pl-[1.625rem] sm:pl-7";

type BadgeKind = "in_use" | "unsaved" | "selected_there";

const BADGE: Record<BadgeKind, { key: I18nKey; className: string }> = {
  in_use: {
    key: "folder_list.badge.in_use",
    className: "bg-[color-mix(in_srgb,var(--vault-status-open)_20%,transparent)] text-vault-open",
  },
  unsaved: {
    key: "folder_list.badge.unsaved",
    className: "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-[var(--accent)]",
  },
  selected_there: {
    key: "folder_list.badge.selected_there",
    className: "bg-surface-container-highest text-on-surface-variant",
  },
};

/**
 * A word beside a choice's name: In use (the data folder open now), Not
 * saved (a row a save would write: new, or with another name or path), or
 * Chosen there (another device's selection).
 */
export function ListBadge({ kind }: { kind: BadgeKind }) {
  const { t } = useTranslation();
  return (
    <span
      className={[
        "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        BADGE[kind].className,
      ].join(" ")}
    >
      {t(BADGE[kind].key)}
    </span>
  );
}

/** This device's heading in a list: what it is to the list, and its name (`deviceName`). */
export function DeviceHeading({ heading, name }: { heading: string; name: string }) {
  return (
    <div>
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
        {heading}
      </span>
      <span className="text-sm font-medium text-on-surface">{name}</span>
    </div>
  );
}

/**
 * What a choice says: its name with its badges, a description, its folder
 * (as a list shows it, the address it stands for on hover), then any lines
 * under them (a problem, a status).
 */
export function RowText({
  title,
  badges,
  description,
  folder,
  fullFolder,
  children,
}: {
  title: string;
  badges?: ReactNode;
  description?: string;
  folder?: string | null;
  /** The folder as typed, when the shown name differs from it. */
  fullFolder?: string;
  children?: ReactNode;
}) {
  return (
    <span className="block min-w-0 flex-1">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 break-words text-sm font-medium leading-snug text-on-surface">
          {title}
        </span>
        {badges}
      </span>
      {description ? (
        <span className="mt-0.5 block text-xs leading-relaxed text-on-surface-variant">
          {description}
        </span>
      ) : null}
      {folder ? (
        <span
          className="mt-0.5 block break-all font-mono text-xs leading-relaxed text-on-surface-variant"
          title={fullFolder && fullFolder !== folder ? fullFolder : undefined}
        >
          {folder}
        </span>
      ) : null}
      {children}
    </span>
  );
}

/**
 * A row's actions, behind one ⋯ button at its end: outside the radio, so
 * none of them selects the row. Labelled items, the reason a disabled one
 * waits under it.
 */
export function RowMenu({ name, items }: { name: string; items: DropdownMenuItem[] }) {
  const { t } = useTranslation();
  return (
    <DropdownMenu
      label={name}
      aboveModal
      trigger={
        <IconButton
          label={t("action.row_options", { name })}
          variant="ghost"
          className="-my-2 -mr-2"
        >
          <Icon name="more-horizontal" size={16} />
        </IconButton>
      }
      items={items}
    />
  );
}

/** A question a row asks before it goes, under it, with its confirm and Cancel. */
export function RowConfirm({
  question,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  question: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-outline-variant pt-3">
      <p className="min-w-0 flex-1 basis-48 text-xs leading-relaxed text-on-surface" role="alert">
        {question}
      </p>
      <div className="ml-auto flex shrink-0 gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t("action.cancel")}
        </Button>
        <Button variant="danger" size="sm" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
