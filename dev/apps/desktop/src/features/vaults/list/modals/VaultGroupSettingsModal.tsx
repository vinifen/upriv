import { useEffect, useId, useRef, useState } from "react";
import {
  PolicyRadioOption,
  SettingsField,
  SettingsFormGrid,
  settingsControlClass,
  VaultSettingsSection,
} from "@/components/settings";
import { Icon } from "@/components/icons";
import { Button, LoadingBudgetHint, Modal, SwitchRow } from "@/components/ui";
import { useLoadingBudget } from "@upriv/shared/react";
import { useTranslation } from "@/i18n";
import { desktopErrorI18nKey } from "@/lib/errorMessages";
import {
  GROUPED_VAULT_SORT_MODES,
  LOADING_BUDGET_MS,
  VAULT_DISPLAY_NAME_MAX_LENGTH,
  displayNameErrorI18nKey,
  validateDisplayName,
  SORT_DIRECTION_ICON,
  SORT_MODE_ICON,
  type GroupedVaultSortMode,
  type VaultGroup,
  type VaultListItem,
  type VaultListSortDirection,
} from "@upriv/shared";
import { GroupedVaultPicker } from "./GroupedVaultPicker";

const GROUPED_SORT_DIRS: VaultListSortDirection[] = ["asc", "desc"];

export interface VaultGroupSettingsSavePatch {
  displayName: string;
  order: number;
  groupedVaults: string[];
  groupedVaultSort: GroupedVaultSortMode;
  groupedVaultSortDirection: VaultListSortDirection;
  hidden: boolean;
}

interface VaultGroupSettingsModalProps {
  group: VaultGroup | null;
  vaults: VaultListItem[];
  groups: VaultGroup[];
  includeHidden?: boolean;
  open: boolean;
  onClose: () => void;
  onSave: (patch: VaultGroupSettingsSavePatch) => Promise<void> | void;
  onDelete: () => Promise<void> | void;
  onBusyTimeout?: () => void;
}

export function VaultGroupSettingsModal({
  group,
  vaults,
  groups,
  includeHidden = false,
  open,
  onClose,
  onSave,
  onDelete,
  onBusyTimeout,
}: VaultGroupSettingsModalProps) {
  const { t } = useTranslation();
  const nameId = useId();
  const orderId = useId();
  const sortModeId = useId();
  const sortDirId = useId();
  const busyGen = useRef(0);
  const hydratedGroupId = useRef<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [order, setOrder] = useState(0);
  const [groupedVaults, setGroupedVaults] = useState<string[]>([]);
  const [groupedVaultSort, setGroupedVaultSort] = useState<GroupedVaultSortMode>("order");
  const [groupedVaultSortDirection, setGroupedVaultSortDirection] =
    useState<VaultListSortDirection>("asc");
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const budget = useLoadingBudget(busy, LOADING_BUDGET_MS.default);

  useEffect(() => {
    if (!open || !group) {
      hydratedGroupId.current = null;
      busyGen.current += 1;
      setDisplayName("");
      setOrder(0);
      setGroupedVaults([]);
      setGroupedVaultSort("order");
      setGroupedVaultSortDirection("asc");
      setHidden(false);
      setBusy(false);
      setDeleteOpen(false);
      setError(null);
      return;
    }
    if (hydratedGroupId.current === group.id) return;
    hydratedGroupId.current = group.id;
    setDisplayName(group.displayName);
    setOrder(group.order);
    setGroupedVaults([...group.groupedVaults]);
    setGroupedVaultSort(group.groupedVaultSort);
    setGroupedVaultSortDirection(group.groupedVaultSortDirection);
    setHidden(group.hidden);
  }, [open, group]);

  useEffect(() => {
    if (!budget.timedOut || !busy) return;
    busyGen.current += 1;
    onBusyTimeout?.();
    setBusy(false);
    setError(t("error.operation_timed_out"));
  }, [budget.timedOut, busy, onBusyTimeout, t]);

  const validation = validateDisplayName(displayName);
  const canSave = Boolean(group) && !validation && !busy;
  const canConfirmDelete = group !== null && !busy;

  const toggleGroupedVault = (vaultId: string) => {
    setGroupedVaults((current) =>
      current.includes(vaultId) ? current.filter((id) => id !== vaultId) : [...current, vaultId],
    );
  };

  const close = () => {
    if (busy) return;
    onClose();
  };

  const save = async () => {
    if (!canSave) return;
    const generation = ++busyGen.current;
    setBusy(true);
    setError(null);
    try {
      await onSave({
        displayName: displayName.trim(),
        order,
        groupedVaults,
        groupedVaultSort,
        groupedVaultSortDirection,
        hidden,
      });
      if (generation !== busyGen.current) return;
      onClose();
    } catch (caught) {
      if (generation !== busyGen.current) return;
      setError(t(desktopErrorI18nKey(caught)));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!canConfirmDelete) return;
    const generation = ++busyGen.current;
    setBusy(true);
    setError(null);
    try {
      await onDelete();
      if (generation !== busyGen.current) return;
      onClose();
    } catch (caught) {
      if (generation !== busyGen.current) return;
      setError(t(desktopErrorI18nKey(caught)));
      setBusy(false);
    }
  };

  if (!open || !group) return null;

  return (
    <Modal
      open={open}
      title={t("vault.group.settings.title")}
      titleIcon="layers"
      contextTitle={group.displayName}
      onClose={close}
      dismissible={!busy}
      panelClassName="max-w-xl"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="md" onClick={close} disabled={busy}>
            {t("action.cancel")}
          </Button>
          <Button variant="primary" size="md" disabled={!canSave} onClick={() => void save()}>
            {t("vault.group.settings.save")}
          </Button>
        </div>
      }
    >
      <div className="space-y-2">
        <VaultSettingsSection title={t("vault.group.settings.section_general")} defaultOpen>
          <SettingsFormGrid>
            <SettingsField
              label={t("vault.group.settings.rename")}
              htmlFor={nameId}
              disabled={busy}
            >
              <input
                id={nameId}
                className={settingsControlClass}
                value={displayName}
                disabled={busy}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </SettingsField>
            {validation ? (
              <p className="text-sm text-on-error-container">
                {t(
                  displayNameErrorI18nKey(validation),
                  validation === "too_long"
                    ? { max: String(VAULT_DISPLAY_NAME_MAX_LENGTH) }
                    : undefined,
                )}
              </p>
            ) : null}
            <SettingsField
              label={t("vault.group.settings.order")}
              hint={t("vault.group.settings.order_help")}
              htmlFor={orderId}
              disabled={busy}
            >
              <input
                id={orderId}
                type="number"
                min={0}
                step={1}
                value={order}
                disabled={busy}
                onChange={(event) =>
                  setOrder(Math.max(0, Number.parseInt(event.target.value, 10) || 0))
                }
                className={[settingsControlClass, "font-mono tabular-nums"].join(" ")}
              />
            </SettingsField>
            <SettingsField
              label={t("vault.list.sort.by_label")}
              hint={t("vault.group.settings.grouped_vault_sort_help")}
              disabled={busy}
            >
              <div
                role="radiogroup"
                aria-label={t("vault.list.sort.by_label")}
                className="grid gap-2"
              >
                {GROUPED_VAULT_SORT_MODES.map((mode) => (
                  <PolicyRadioOption
                    key={mode}
                    groupName={sortModeId}
                    value={mode}
                    checked={groupedVaultSort === mode}
                    disabled={busy}
                    title={t(`vault.list.sort.mode.${mode}`)}
                    icon={
                      <Icon
                        name={SORT_MODE_ICON[mode]}
                        size={18}
                        className="text-on-surface-variant"
                      />
                    }
                    badge={mode === "order" ? "default" : undefined}
                    onSelect={() => setGroupedVaultSort(mode)}
                  />
                ))}
              </div>
            </SettingsField>
            <SettingsField label={t("vault.list.sort.direction_label")} disabled={busy}>
              <div
                role="radiogroup"
                aria-label={t("vault.list.sort.direction_label")}
                className="grid gap-2"
              >
                {GROUPED_SORT_DIRS.map((direction) => (
                  <PolicyRadioOption
                    key={direction}
                    groupName={sortDirId}
                    value={direction}
                    checked={groupedVaultSortDirection === direction}
                    disabled={busy}
                    title={t(`vault.list.sort.direction.${direction}`)}
                    icon={
                      <Icon
                        name={SORT_DIRECTION_ICON[direction]}
                        size={18}
                        className="text-on-surface-variant"
                      />
                    }
                    badge={direction === "asc" ? "default" : undefined}
                    onSelect={() => setGroupedVaultSortDirection(direction)}
                  />
                ))}
              </div>
            </SettingsField>
            <SwitchRow
              checked={hidden}
              onChange={setHidden}
              disabled={busy}
              label={t("vault.group.settings.hidden")}
              hint={t("vault.group.settings.hidden_help")}
            />
          </SettingsFormGrid>
        </VaultSettingsSection>

        <VaultSettingsSection title={t("vault.group.settings.section_vaults")}>
          <SettingsFormGrid>
            <p className="text-sm text-on-surface-variant">
              {t("vault.group.settings.grouped_vaults_help")}
            </p>
            <GroupedVaultPicker
              vaults={vaults}
              groups={groups}
              excludeGroupId={group.id}
              includeHidden={includeHidden}
              selectedIds={groupedVaults}
              disabled={busy}
              onToggle={toggleGroupedVault}
            />
          </SettingsFormGrid>
        </VaultSettingsSection>

        <VaultSettingsSection
          key={deleteOpen ? "danger-open" : "danger"}
          title={t("modal.settings.danger_zone")}
          tone="danger"
          defaultOpen={deleteOpen}
        >
          {!deleteOpen ? (
            <div className="space-y-3">
              <p className="text-sm text-on-surface-variant">
                {t("vault.group.settings.delete_help")}
              </p>
              <Button
                variant="danger"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setDeleteOpen(true);
                }}
              >
                {t("vault.group.settings.delete")}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-on-surface-variant">
                {t("vault.group.settings.delete_confirm")}
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setDeleteOpen(false);
                  }}
                >
                  {t("action.cancel")}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={!canConfirmDelete}
                  onClick={() => void remove()}
                >
                  {t("action.delete")}
                </Button>
              </div>
            </div>
          )}
        </VaultSettingsSection>

        {budget.visible ? (
          <LoadingBudgetHint budgetMs={budget.budgetMs} remainingMs={budget.remainingMs} />
        ) : null}
        {error ? <p className="text-sm text-on-error-container">{error}</p> : null}
      </div>
    </Modal>
  );
}
