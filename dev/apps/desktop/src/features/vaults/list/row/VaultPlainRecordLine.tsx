import { useState } from "react";
import { deviceName, unreachablePlainRecord, type VaultListItem } from "@upriv/shared";
import { Button } from "@/components/ui";
import { useTranslation } from "@/i18n";

interface VaultPlainRecordLineProps {
  vault: VaultListItem;
  /** Check the recorded folders again (a list refresh). */
  onRetry: () => void;
  /** Drop the record: its files stay on that drive. */
  onForget: (vault: VaultListItem, token: string) => void;
}

/**
 * A plain-text folder on record that this device cannot reach keeps the
 * vault from opening: the row names its device and folder, with Retry and
 * Forget, which asks first.
 */
export function VaultPlainRecordLine({ vault, onRetry, onForget }: VaultPlainRecordLineProps) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  const record = unreachablePlainRecord(vault.plainRecords ?? []);
  if (!record) return null;
  const device = deviceName(record.device.id, record.device.system, t);
  const message =
    record.state === "elsewhere"
      ? t("plain.record.elsewhere", { device, path: record.path })
      : t("plain.record.away", { device, path: record.path });
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-2 text-xs"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <p className="min-w-0 flex-1 break-words text-on-error-container" role="alert">
        {asking ? t("plain.record.forget_confirm") : message}
      </p>
      {asking ? (
        <>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              setAsking(false);
              onForget(vault, record.token);
            }}
          >
            {t("plain.record.forget")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>
            {t("action.cancel")}
          </Button>
        </>
      ) : (
        <>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {t("action.retry")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setAsking(true)}>
            {t("plain.record.forget")}
          </Button>
        </>
      )}
    </div>
  );
}
