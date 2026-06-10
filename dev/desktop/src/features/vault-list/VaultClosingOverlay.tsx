import { useTranslation } from "@/i18n";
import type { I18nKey } from "@/i18n/types";
import { CLOSING_PIPELINE_STEPS } from "./vaultClosingPipeline";
import { VaultPipelineOverlay } from "./VaultPipelineOverlay";
import type { VaultListItem } from "./types";
import type { VaultLifecycleIntent } from "./vaultLifecycleTypes";

interface VaultClosingOverlayProps {
  vault: VaultListItem | null;
  intent: Extract<VaultLifecycleIntent, "close" | "seal"> | null;
  open: boolean;
  activeStep: number;
  errorKey?: I18nKey | null;
  onBackground: () => void;
  onDismissError?: () => void;
}

export function VaultClosingOverlay({
  vault,
  intent,
  open,
  activeStep,
  errorKey = null,
  onBackground,
  onDismissError,
}: VaultClosingOverlayProps) {
  const { t } = useTranslation();

  if (!intent) return null;

  const title =
    intent === "seal"
      ? t("close.overlay.title_seal", { name: vault?.displayName ?? "" })
      : t("close.overlay.title_close", { name: vault?.displayName ?? "" });

  return (
    <VaultPipelineOverlay
      vault={vault}
      open={open}
      title={title}
      hint={t("close.overlay.hint")}
      stepKeys={CLOSING_PIPELINE_STEPS}
      activeStep={activeStep}
      errorKey={errorKey}
      onBackground={onBackground}
      onDismissError={onDismissError}
    />
  );
}
