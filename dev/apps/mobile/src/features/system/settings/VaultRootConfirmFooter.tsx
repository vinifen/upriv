import { useEffect, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { I18nKey, VaultRootConfirmAction } from "@upriv/shared";
import { Button, ElapsedTime, JobStopButton } from "@/components/ui";
import { ModalFooterActions } from "@/components/ui/ModalFooterActions";
import { useOperationLimit } from "@upriv/shared/react";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";
import type { DataFolderCopy } from "./useDataFolderCopy";

interface VaultRootConfirmFooterProps {
  busy: boolean;
  /** Gate unresolved (incomplete without policy, missing path, …) or no draft change. */
  blocked: boolean;
  confirmOpen: boolean;
  /** Side-effect reminders shown only while confirming. */
  noteKeys?: readonly I18nKey[];
  /**
   * Blocking gates (Setup / Repair / Recovery) use Continue;
   * Data folder uses Apply.
   * @default "continue"
   */
  primaryAction?: VaultRootConfirmAction;
  /** Style the confirm button as danger (e.g. incomplete delete). */
  confirmDanger?: boolean;
  /** Shown above the primary when not confirming (e.g. folder inspect in progress). */
  idleStatusKey?: I18nKey;
  /** Success line (e.g. Applied) — replaces idle/confirm copy while set. */
  successKey?: I18nKey;
  /** First tap — open the confirm step. */
  onRequestPrimary: () => void;
  /** Second tap — run the side effects. */
  onConfirmPrimary: () => void;
  onCancelConfirm: () => void;
  /** `OPERATION_LIMIT_MS` passed while `busy` — parent must clear busy and surface retry/error. */
  onBusyTimeout?: () => void;
  /** The private data folder copy this setup runs: Stop replaces the primary. */
  copy?: DataFolderCopy | null;
  onStopCopy?: () => void;
}

/**
 * Two-step primary footer: first tap opens confirm + notes; second tap commits.
 * Mirrors desktop `VaultRootConfirmFooter` semantics (busy timeout, confirmDanger,
 * success line) using RN Button primitives.
 */
export function VaultRootConfirmFooter({
  busy,
  blocked,
  confirmOpen,
  noteKeys = [],
  primaryAction = "continue",
  confirmDanger = false,
  idleStatusKey,
  successKey,
  onRequestPrimary,
  onConfirmPrimary,
  onCancelConfirm,
  onBusyTimeout,
  copy = null,
  onStopCopy,
}: VaultRootConfirmFooterProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const primaryDisabled = busy || blocked;
  const isApply = primaryAction === "apply";
  const showIdleStatus = !confirmOpen && !successKey && idleStatusKey != null;
  // A copy has no time limit: it ends when it is done, fails, or is stopped.
  const limit = useOperationLimit(busy && !successKey && !copy);
  const timedOutNotified = useRef(false);

  useEffect(() => {
    if (!busy) {
      timedOutNotified.current = false;
      return;
    }
    if (!limit.timedOut || timedOutNotified.current) return;
    timedOutNotified.current = true;
    onBusyTimeout?.();
  }, [limit.timedOut, busy, onBusyTimeout]);

  return (
    <View style={styles.wrap}>
      <View accessibilityLiveRegion="polite">
        {successKey ? (
          <Text
            style={[typography.body, { color: colors.vaultStatusOpen }]}
            accessibilityRole="text"
          >
            {t(successKey)}
          </Text>
        ) : copy ? (
          <View style={styles.copyRow}>
            <Text style={typography.bodyMuted}>{t("modal.vault_root_setup.busy")}</Text>
            {copy.stoppingSince === null ? (
              <ElapsedTime startedAt={copy.startedAt} layout="inline" />
            ) : null}
          </View>
        ) : confirmOpen ? (
          <View style={styles.confirmCol}>
            <Text style={typography.bodyMuted}>
              {t(
                isApply
                  ? "modal.data_folder.apply_confirm"
                  : "modal.vault_root_gate.continue_confirm",
              )}
            </Text>
            {noteKeys.map((key) => (
              <Text key={key} style={[typography.caption, { color: colors.onErrorContainer }]}>
                {t(key)}
              </Text>
            ))}
          </View>
        ) : showIdleStatus ? (
          <Text style={typography.bodyMuted} accessibilityRole="text">
            {t(idleStatusKey!)}
          </Text>
        ) : busy && limit.visible ? (
          <Text style={typography.bodyMuted}>{t("modal.vault_root_setup.busy")}</Text>
        ) : null}
      </View>

      {copy ? (
        <ModalFooterActions layout="confirm">
          <JobStopButton
            stoppingSince={copy.stoppingSince}
            stoppable={copy.progress?.stoppable ?? true}
            onStop={() => onStopCopy?.()}
          />
        </ModalFooterActions>
      ) : (
        <ModalFooterActions layout="confirm">
          <Button
            variant={confirmOpen && confirmDanger ? "danger" : "primary"}
            label={
              confirmOpen
                ? t(
                    isApply
                      ? "modal.data_folder.apply_confirm_action"
                      : "modal.vault_root_gate.continue_confirm_action",
                  )
                : t(isApply ? "action.apply" : "action.continue")
            }
            busy={busy && !successKey}
            disabled={primaryDisabled}
            onPress={confirmOpen ? onConfirmPrimary : onRequestPrimary}
          />
          {confirmOpen ? (
            <Button
              variant="ghost"
              label={t("action.cancel")}
              disabled={busy}
              onPress={onCancelConfirm}
            />
          ) : null}
        </ModalFooterActions>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  confirmCol: { gap: spacing.xs },
  copyRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
});
