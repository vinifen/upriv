import { useEffect, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { I18nKey, VaultRootConfirmAction } from "@upriv/shared";
import { LOADING_BUDGET_MS } from "@upriv/shared";
import { Button, LoadingBudgetHint } from "@/components/ui";
import { ModalFooterActions, modalFooterConfirmBtnStyle } from "@/components/ui/ModalFooterActions";
import { useLoadingBudget } from "@upriv/shared/react";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";

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
  /** Budget exhausted while `busy` — parent must clear busy and surface retry/error. */
  onBusyTimeout?: () => void;
}

/**
 * Two-step primary footer: first tap opens confirm + notes; second tap commits.
 * Mirrors desktop `VaultRootConfirmFooter` semantics (busy timeout, confirmDanger,
 * success line) using RN Button / LoadingBudgetHint primitives.
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
}: VaultRootConfirmFooterProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const primaryDisabled = busy || blocked;
  const isApply = primaryAction === "apply";
  const showIdleStatus = !confirmOpen && !successKey && idleStatusKey != null;
  const budget = useLoadingBudget(busy && !successKey, LOADING_BUDGET_MS.vaultRoot);
  const timedOutNotified = useRef(false);

  useEffect(() => {
    if (!busy) {
      timedOutNotified.current = false;
      return;
    }
    if (!budget.timedOut || timedOutNotified.current) return;
    timedOutNotified.current = true;
    onBusyTimeout?.();
  }, [budget.timedOut, busy, onBusyTimeout]);

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
            {busy && budget.visible ? (
              <LoadingBudgetHint budgetMs={budget.budgetMs} remainingMs={budget.remainingMs} />
            ) : null}
          </View>
        ) : showIdleStatus ? (
          <Text style={typography.bodyMuted} accessibilityRole="text">
            {t(idleStatusKey!)}
          </Text>
        ) : busy && budget.visible ? (
          <View style={styles.confirmCol}>
            <Text style={typography.bodyMuted}>{t("modal.vault_root_setup.busy")}</Text>
            <LoadingBudgetHint budgetMs={budget.budgetMs} remainingMs={budget.remainingMs} />
          </View>
        ) : null}
      </View>

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
          style={modalFooterConfirmBtnStyle}
          busy={busy && !successKey}
          disabled={primaryDisabled}
          onPress={confirmOpen ? onConfirmPrimary : onRequestPrimary}
        />
        {confirmOpen ? (
          <Button
            variant="ghost"
            label={t("action.cancel")}
            style={modalFooterConfirmBtnStyle}
            disabled={busy}
            onPress={onCancelConfirm}
          />
        ) : null}
      </ModalFooterActions>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  confirmCol: { gap: spacing.xs },
});
