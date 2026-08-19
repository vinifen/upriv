import { useTranslation } from "@/i18n";
import type { CreateVaultStepId, CreateVaultStepStatus } from "@upriv/shared";

interface CreateVaultStepNavProps {
  currentStep: CreateVaultStepId;
  stepStatuses: Record<CreateVaultStepId, CreateVaultStepStatus>;
  onSelectStep: (step: CreateVaultStepId) => void;
}

const STEP_LABEL_KEYS: Record<
  CreateVaultStepId,
  | "vault.create.step.source"
  | "vault.create.step.identity"
  | "vault.create.step.password"
  | "vault.create.step.general"
  | "vault.create.step.advanced"
> = {
  source: "vault.create.step.source",
  identity: "vault.create.step.identity",
  password: "vault.create.step.password",
  general: "vault.create.step.general",
  advanced: "vault.create.step.advanced",
};

const STEPS: CreateVaultStepId[] = ["source", "identity", "password", "general", "advanced"];

function stepButtonClass(isCurrent: boolean): string {
  return [
    // Always border-2 so the active step does not grow against the modal clip edge.
    "flex min-h-[3.75rem] w-full min-w-0 items-center gap-2 rounded-lg border-2 px-2.5 py-3 text-left transition-colors sm:gap-2.5 sm:px-3 sm:py-3.5",
    isCurrent
      ? "border-[var(--accent)] bg-surface-container"
      : "border-outline-variant bg-surface-container/50 hover:bg-surface-container/80",
  ].join(" ");
}

function stepBadgeClass(status: CreateVaultStepStatus): string {
  return [
    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold",
    status === "ready"
      ? "bg-vault-open/15 text-vault-open"
      : status === "error"
        ? "bg-on-error-container/15 text-on-error-container"
        : "bg-surface-container-highest text-on-surface-variant",
  ].join(" ");
}

function stepStatusClass(status: CreateVaultStepStatus): string {
  return [
    "block truncate text-[10px] uppercase tracking-wide",
    status === "ready"
      ? "text-vault-open"
      : status === "error"
        ? "text-on-error-container"
        : "text-on-surface-variant",
  ].join(" ");
}

export function CreateVaultStepNav({
  currentStep,
  stepStatuses,
  onSelectStep,
}: CreateVaultStepNavProps) {
  const { t } = useTranslation();

  return (
    <nav className="mt-4 min-w-0 shrink-0" aria-label={t("vault.create.step_nav")}>
      <ul className="flex gap-1.5 sm:gap-2">
        {STEPS.map((stepId, index) => {
          const status = stepStatuses[stepId];
          const isCurrent = currentStep === stepId;

          return (
            <li key={stepId} className="min-w-0 flex-1 basis-0">
              <button
                type="button"
                onClick={() => onSelectStep(stepId)}
                className={stepButtonClass(isCurrent)}
              >
                <span className={stepBadgeClass(status)} aria-hidden>
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 overflow-hidden">
                  <span className="block truncate text-xs font-medium text-on-surface">
                    {t(STEP_LABEL_KEYS[stepId])}
                  </span>
                  <span className={stepStatusClass(status)}>
                    {t(`vault.create.step_status.${status}`)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
