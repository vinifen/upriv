import { useEffect } from "react";
import { Text } from "react-native";
import {
  vaultClosePromptBodyKey,
  vaultClosePromptTitleKey,
  type VaultClosePrompt,
} from "@upriv/shared";
import { useOperationLimit } from "@upriv/shared/react";
import { useTranslation } from "@/i18n";
import { Button, Modal, ModalFooterActions } from "@/components/ui";
import { useTheme } from "@/theme";

interface VaultClosePromptModalProps {
  prompt: VaultClosePrompt | null;
  /** The vault's name when the prompt is for one vault. */
  vaultName?: string;
  saving: boolean;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
  onSaveTimeout: () => void;
  /** Import: stop storing the files still waiting, then close once the current one lands. */
  onCancelImport: () => void;
}

/**
 * Asks from the vault list before a close, for one vault or every open one,
 * and leaves the file manager where it is: unsaved drafts are saved or
 * discarded; a running import keeps the vault open or is cut short.
 */
export function VaultClosePromptModal({
  prompt,
  vaultName,
  saving,
  onCancel,
  onDiscard,
  onSave,
  onSaveTimeout,
  onCancelImport,
}: VaultClosePromptModalProps) {
  const { t } = useTranslation();
  const { typography, colors } = useTheme();
  const open = prompt !== null;
  const limit = useOperationLimit(open && saving);

  useEffect(() => {
    if (limit.timedOut) onSaveTimeout();
  }, [limit.timedOut, onSaveTimeout]);

  if (!prompt) return null;
  const unsaved = prompt.blocker === "unsaved";

  return (
    <Modal
      open={open}
      title={t(vaultClosePromptTitleKey(prompt))}
      contextTitle={prompt.all ? undefined : vaultName}
      titleIcon="file"
      panelClassName="max-w-md"
      onClose={onCancel}
      footer={
        unsaved ? (
          <ModalFooterActions layout="dialog">
            <Button
              label={t("action.cancel")}
              variant="ghost"
              size="sm"
              disabled={saving}
              onPress={onCancel}
            />
            <Button
              label={t("modal.file_manager.unsaved.discard_all")}
              variant="danger"
              size="sm"
              disabled={saving}
              onPress={onDiscard}
            />
            <Button
              label={t("modal.file_manager.unsaved.save_all")}
              variant="primary"
              size="sm"
              disabled={saving}
              onPress={onSave}
            />
          </ModalFooterActions>
        ) : (
          <ModalFooterActions layout="dialog">
            <Button
              label={t("modal.file_manager.import_in_progress.close_and_cancel")}
              variant="danger"
              size="sm"
              onPress={onCancelImport}
            />
            <Button
              label={t("modal.file_manager.import_in_progress.stay")}
              variant="primary"
              size="sm"
              onPress={onCancel}
            />
          </ModalFooterActions>
        )
      }
    >
      <Text style={[typography.body, { color: colors.onSurfaceVariant }]}>
        {t(vaultClosePromptBodyKey(prompt))}
      </Text>
    </Modal>
  );
}
