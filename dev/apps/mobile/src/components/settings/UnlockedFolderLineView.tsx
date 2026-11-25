import { View } from "react-native";
import type { UnlockedFolderLine } from "@upriv/shared";
import { useOperationLimit } from "@upriv/shared/react";
import { shownPath } from "@/components/folder-list/shownPath";
import { useTranslation, type I18nKey } from "@/i18n";
import { spacing } from "@/theme/tokens";
import { FieldHint } from "./settingsFields";

/**
 * Where a vault's files will appear on this device, with the warning of a
 * removable, network, or cloud folder. The folder lists sit in files no
 * vault key protects, so the folder is shown before the password. A folder
 * inside a picked tree is named as the Files app names it (`shownPath`).
 */
export function UnlockedFolderLineView({
  checking,
  line,
  checkingKey,
}: {
  /** The lookup has not answered yet. */
  checking: boolean;
  line: UnlockedFolderLine | null;
  /** Shown while the lookup runs, after the usual loading delay. */
  checkingKey: I18nKey;
}) {
  const { t } = useTranslation();
  const { visible } = useOperationLimit(checking);
  if (checking) return visible ? <FieldHint>{t(checkingKey)}</FieldHint> : null;
  if (!line) return null;
  const params = line.params?.path
    ? { ...line.params, path: shownPath(line.params.path) }
    : line.params;
  return (
    <View style={{ gap: spacing.xs }}>
      <FieldHint>{t(line.key, params)}</FieldHint>
      {line.warning ? <FieldHint>{t(line.warning)}</FieldHint> : null}
    </View>
  );
}
