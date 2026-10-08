import { revealableLocation, isAbsoluteOsFilesystemPath } from "@upriv/shared";
import { useToast } from "@upriv/shared/react";
import { Icon } from "@/components/icons";
import { IconButton, Toast } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { revealFailureKey } from "@/lib/revealInOs";
import { rpcRevealOsPath } from "@/lib/rpc";

/** Opens an absolute OS path in Finder, Explorer, or the desktop file manager. */
export function RevealPathButton({
  path,
  inset = false,
}: {
  path: string | null | undefined;
  /** Fills the path field’s height so the hit target is the whole right edge. */
  inset?: boolean;
}) {
  const { t } = useTranslation();
  const { toast, show, dismiss } = useToast();
  const location = revealableLocation(path);
  if (!location || !isAbsoluteOsFilesystemPath(location)) return null;

  const open = async () => {
    const failure = await revealFailureKey(() => rpcRevealOsPath(location));
    if (failure) show(t(failure));
  };
  const label = t("modal.file_manager.context.open_system");

  return (
    <>
      {inset ? (
        <button
          type="button"
          aria-label={label}
          onClick={() => void open()}
          className="inline-flex w-10 shrink-0 items-center justify-center text-on-surface-variant outline-none hover:bg-surface-container-high hover:text-on-surface active:bg-surface-container-high"
        >
          <Icon name="file-manager" size={18} />
        </button>
      ) : (
        <IconButton label={label} size="md" variant="ghost" onClick={() => void open()}>
          <Icon name="file-manager" size={18} />
        </IconButton>
      )}
      <Toast toast={toast} onDismiss={dismiss} />
    </>
  );
}
