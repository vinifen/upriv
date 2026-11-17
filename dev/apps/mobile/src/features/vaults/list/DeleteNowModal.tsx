import { Text } from "react-native";
import type { VaultListItem } from "@upriv/shared";
import { Button, Modal, ModalFooterActions } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";

interface DeleteNowModalProps {
  /** The vault whose delete ends early; `null` keeps the window closed. */
  vault: VaultListItem | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Delete now always asks first: the files it has not reached go without an
 * overwrite, so their bytes stay on the disk until it reuses the space.
 */
export function DeleteNowModal({ vault, onCancel, onConfirm }: DeleteNowModalProps) {
  const { t } = useTranslation();
  const { typography, colors } = useTheme();
  return (
    <Modal
      open={vault !== null}
      title={t("modal.delete_now.title")}
      titleIcon="trash"
      contextTitle={vault?.displayName}
      panelClassName="max-w-md"
      onClose={onCancel}
      footer={
        <ModalFooterActions layout="dialog">
          <Button label={t("action.cancel")} variant="ghost" size="sm" onPress={onCancel} />
          <Button
            label={t("modal.delete_now.confirm")}
            variant="danger"
            size="sm"
            onPress={onConfirm}
          />
        </ModalFooterActions>
      }
    >
      <Text style={[typography.body, { color: colors.onSurfaceVariant }]}>
        {t("modal.delete_now.body")}
      </Text>
    </Modal>
  );
}
