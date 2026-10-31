import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { closeNowNoticeKeys, storageModeIsPlaintext, type VaultListItem } from "@upriv/shared";
import { Button, Checkbox, Modal, ModalFooterActions } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";

interface CloseNowModalProps {
  vault: VaultListItem | null;
  /** An editor tab in this vault has unsaved changes. */
  unsaved: boolean;
  /** The setting is on, so "Don't ask again" has something to turn off. */
  asks: boolean;
  onCancel: () => void;
  onConfirm: (dontAskAgain: boolean) => void;
}

/** What Close now skips, before it runs. */
export function CloseNowModal({ vault, unsaved, asks, onCancel, onConfirm }: CloseNowModalProps) {
  const { t } = useTranslation();
  const { typography, colors } = useTheme();
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const vaultId = vault?.id;

  useEffect(() => {
    setDontAskAgain(false);
  }, [vaultId]);

  return (
    <Modal
      open={vault !== null}
      title={t("modal.close_now.title")}
      titleIcon="lock"
      contextTitle={vault?.displayName}
      panelClassName="max-w-md"
      onClose={onCancel}
      footer={
        <ModalFooterActions layout="dialog">
          <Button label={t("action.cancel")} variant="ghost" size="sm" onPress={onCancel} />
          <Button
            label={t("modal.close_now.confirm")}
            variant="danger"
            size="sm"
            onPress={() => onConfirm(dontAskAgain)}
          />
        </ModalFooterActions>
      }
    >
      {vault ? (
        <View style={{ gap: 12 }}>
          <Text style={[typography.body, { color: colors.onSurfaceVariant }]}>
            {t("modal.close_now.intro")}
          </Text>
          <View style={{ gap: 6 }}>
            {closeNowNoticeKeys(storageModeIsPlaintext(vault.storageMode)).map((key) => (
              <View key={key} style={{ flexDirection: "row", gap: 8 }}>
                <Text style={[typography.body, { color: colors.onSurfaceVariant }]}>•</Text>
                <Text style={[typography.body, { color: colors.onSurfaceVariant, flex: 1 }]}>
                  {t(key)}
                </Text>
              </View>
            ))}
          </View>
          {unsaved ? (
            <Text style={[typography.body, { color: colors.onSurface, fontWeight: "500" }]}>
              {t("modal.close_now.unsaved")}
            </Text>
          ) : null}
          {asks ? (
            <View style={{ gap: 4 }}>
              <Pressable
                onPress={() => setDontAskAgain((prev) => !prev)}
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: dontAskAgain }}
                accessibilityLabel={t("modal.close_now.dont_ask")}
              >
                <Checkbox checked={dontAskAgain} interactive={false} />
                <Text style={[typography.body, { color: colors.onSurfaceVariant, flex: 1 }]}>
                  {t("modal.close_now.dont_ask")}
                </Text>
              </Pressable>
              {dontAskAgain ? (
                <Text style={typography.caption}>{t("modal.close_now.dont_ask_hint")}</Text>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </Modal>
  );
}
