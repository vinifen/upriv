import { useEffect, useState } from "react";
import { Modal as RnModal, StyleSheet, Text, View } from "react-native";
import type { VaultListItem } from "@upriv/shared";
import { useTranslation, type I18nKey } from "@/i18n";
import { Button } from "@/components/ui";
import { useTheme } from "@/theme";
import { radii, spacing } from "@/theme/tokens";

const PIPELINE_BACKGROUND_AFTER_MS = 1500;

interface VaultPipelineOverlayProps {
  vault: VaultListItem | null;
  open: boolean;
  title: string;
  hint: string;
  stepKeys: readonly I18nKey[];
  activeStep: number;
  errorKey?: I18nKey | null;
  onBackground: () => void;
  onDismissError?: () => void;
}

export function VaultPipelineOverlay({
  vault,
  open,
  title,
  hint,
  stepKeys,
  activeStep,
  errorKey = null,
  onBackground,
  onDismissError,
}: VaultPipelineOverlayProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const [showBackgroundAction, setShowBackgroundAction] = useState(false);
  const failed = errorKey !== null;

  useEffect(() => {
    if (!open || failed) {
      setShowBackgroundAction(false);
      return;
    }
    setShowBackgroundAction(false);
    const timer = setTimeout(() => setShowBackgroundAction(true), PIPELINE_BACKGROUND_AFTER_MS);
    return () => clearTimeout(timer);
  }, [open, vault?.id, failed]);

  if (!open || !vault) return null;

  return (
    <RnModal visible={open} transparent animationType="fade" onRequestClose={onBackground}>
      <View style={[styles.scrim, { backgroundColor: colors.modalScrim }]}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surfaceContainerHigh,
              borderColor: colors.outlineVariant,
            },
          ]}
        >
          <Text style={typography.headline}>{title}</Text>
          <Text style={typography.bodyMuted}>{hint}</Text>

          {failed ? (
            <>
              <Text style={[typography.body, { color: colors.onErrorContainer }]}>{t(errorKey!)}</Text>
              <Button
                label={t("action.close")}
                variant="accent"
                onPress={() => onDismissError?.()}
              />
            </>
          ) : (
            <>
              <View style={styles.steps}>
                {stepKeys.map((key, index) => {
                  const done = index < activeStep;
                  const current = index === activeStep;
                  return (
                    <Text
                      key={key}
                      style={[
                        typography.body,
                        { color: colors.onSurfaceVariant },
                        done ? { color: colors.vaultStatusOpen } : null,
                        current ? { color: colors.onSurface, fontWeight: "600" } : null,
                      ]}
                    >
                      {done ? "✓ " : current ? "… " : "○ "}
                      {t(key)}
                    </Text>
                  );
                })}
              </View>
              {showBackgroundAction ? (
                <Button
                  label={t("pipeline.action.background")}
                  variant="ghost"
                  onPress={onBackground}
                />
              ) : null}
            </>
          )}
        </View>
      </View>
    </RnModal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: spacing.xl,
    gap: spacing.md,
  },
  steps: { gap: spacing.sm, marginVertical: spacing.sm },
});
