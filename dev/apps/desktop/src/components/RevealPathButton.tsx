import { revealableLocation, isAbsoluteOsFilesystemPath } from "@upriv/shared";
import { useToast } from "@upriv/shared/react";
import { Icon } from "@/components/icons";
import { IconButton, Toast } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { revealFailureKey } from "@/lib/revealInOs";
import { rpcRevealOsPath } from "@/lib/rpc";

/**
 * Opening a folder in Finder, Explorer, or the desktop file manager, for a
 * button or a menu item: `locate` gives the absolute OS path a path opens at
 * (`null` when it opens nowhere), `open` opens it, and a failure shows in
 * `toast`, which the caller renders once.
 */
export function useRevealFolder() {
  const { t } = useTranslation();
  const { toast, show, dismiss } = useToast();
  const locate = (path: string | null | undefined): string | null => {
    const location = revealableLocation(path);
    return location && isAbsoluteOsFilesystemPath(location) ? location : null;
  };
  const open = async (location: string) => {
    const failure = await revealFailureKey(() => rpcRevealOsPath(location));
    if (failure) show(t(failure));
  };
  return { locate, open, toast: <Toast toast={toast} onDismiss={dismiss} /> };
}

/** Opens an absolute OS path in Finder, Explorer, or the desktop file manager. */
export function RevealPathButton({
  path,
  inset = false,
  row = false,
}: {
  path: string | null | undefined;
  /** Fills the path field’s height so the hit target is the whole right edge. */
  inset?: boolean;
  /** Sits among a list row's action buttons. */
  row?: boolean;
}) {
  const { t } = useTranslation();
  const reveal = useRevealFolder();
  const location = reveal.locate(path);
  if (!location) return null;

  const open = () => void reveal.open(location);
  const label = t("action.open_folder");

  return (
    <>
      {inset ? (
        <button
          type="button"
          aria-label={label}
          onClick={open}
          className="inline-flex w-10 shrink-0 items-center justify-center text-on-surface-variant outline-none hover:bg-surface-container-high hover:text-on-surface active:bg-surface-container-high"
        >
          <Icon name="file-manager" size={18} />
        </button>
      ) : row ? (
        <IconButton
          label={label}
          size="row"
          variant="row-action"
          className="-mr-1 text-on-surface-variant hover:bg-accent/15 hover:text-accent"
          onClick={open}
        >
          <Icon name="file-manager" size={18} />
        </IconButton>
      ) : (
        <IconButton label={label} size="md" variant="ghost" onClick={open}>
          <Icon name="file-manager" size={18} />
        </IconButton>
      )}
      {reveal.toast}
    </>
  );
}
