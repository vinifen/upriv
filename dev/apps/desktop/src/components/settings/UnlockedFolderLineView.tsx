import type { UnlockedFolderLine } from "@upriv/shared";
import { useOperationLimit } from "@upriv/shared/react";
import { useTranslation } from "@/i18n";
import type { I18nKey } from "@/i18n/types";

interface UnlockedFolderLineViewProps {
  /** The lookup has not answered yet. */
  checking: boolean;
  line: UnlockedFolderLine | null;
  /** Shown while the lookup runs, after the usual loading delay. */
  checkingKey: I18nKey;
}

/**
 * Where a vault's files will appear on this device, with the warning of a
 * removable, network, or cloud folder. The folder lists sit in files no
 * vault key protects, so the folder is shown before the password.
 */
export function UnlockedFolderLineView({
  checking,
  line,
  checkingKey,
}: UnlockedFolderLineViewProps) {
  const { t } = useTranslation();
  const { visible } = useOperationLimit(checking);
  if (checking) {
    return visible ? (
      <p className="text-xs leading-relaxed text-on-surface-variant" role="status">
        {t(checkingKey)}
      </p>
    ) : null;
  }
  if (!line) return null;
  return (
    <div className="space-y-1">
      <p className="break-words text-xs leading-relaxed text-on-surface-variant">
        {t(line.key, line.params)}
      </p>
      {line.warning ? (
        <p className="text-xs leading-relaxed text-on-surface">{t(line.warning)}</p>
      ) : null}
    </div>
  );
}
