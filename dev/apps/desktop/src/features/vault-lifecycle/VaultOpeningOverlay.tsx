import { useTranslation } from "@/i18n";
import type { I18nKey } from "@/i18n/types";
import { OPENING_PIPELINE_STEPS, type VaultListItem } from "@upriv/shared";
import { VaultPipelineOverlay } from "./VaultPipelineOverlay";

interface VaultOpeningOverlayProps {
  vault: VaultListItem | null;
  open: boolean;
  activeStep: number;
  errorKey?: I18nKey | null;
  onBackground: () => void;
  onDismissError?: () => void;
}

export function VaultOpeningOverlay({
  vault,
  open,
  activeStep,
  errorKey = null,
  onBackground,
  onDismissError,
}: VaultOpeningOverlayProps) {
  const { t } = useTranslation();

  return (
    <VaultPipelineOverlay
      vault={vault}
      open={open}
      title={t("open.overlay.title", { name: vault?.displayName ?? "" })}
      hint={t("open.overlay.hint")}
      stepKeys={OPENING_PIPELINE_STEPS}
      activeStep={activeStep}
      errorKey={errorKey}
      onBackground={onBackground}
      onDismissError={onDismissError}
    />
  );
}
