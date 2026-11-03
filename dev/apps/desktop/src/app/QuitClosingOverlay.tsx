import { useEffect, useState } from "react";
import { Button, ElapsedTime, JobStopButton, Modal } from "@/components/ui";
import { useAppSettingsContext } from "@/features/system/settings";
import { CloseNowModal } from "@/features/vaults/lifecycle";
import { useTranslation } from "@/i18n";
import { useDesktopEvent } from "@/lib/useDesktopEvent";
import { useRunningWork } from "@/lib/runningWork";

/**
 * Tells Electron main what runs, whenever it changes: main asks before
 * quitting, waits for the jobs on a normal quit, and keeps the computer awake.
 */
function useWorkReport(): void {
  const { items, closing } = useRunningWork();
  const jobs = items.length;
  useEffect(() => {
    window.upriv?.reportWork?.({ jobs, closing });
  }, [closing, jobs]);
}

/**
 * Shown after the quit dialog. A normal quit first lists the work still
 * running, each with Stop, then closes the open vaults with their backups.
 * Nothing in it has a time limit; Close now is always there. It asks first in
 * the same window as a vault's Close now, with the same "Don't ask again",
 * while `lifecycle_confirm_close_now` is on. After Close now it says the
 * vaults are being sealed, and main stops the backend if that runs out of time.
 */
export function QuitClosingOverlay() {
  const { t } = useTranslation();
  const { settings, patchSettings } = useAppSettingsContext();
  const [active, setActive] = useState(false);
  const [now, setNow] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const { items } = useRunningWork();
  useWorkReport();

  useDesktopEvent("quit_closing", (payload) => {
    const quitNow = (payload as { now?: unknown } | null)?.now === true;
    setNow(quitNow);
    if (quitNow) setConfirming(false);
    setStartedAt((current) => current ?? Date.now());
    setActive(true);
  });

  const asks = settings.ui.lifecycle_confirm_close_now;
  const closeNow = () => window.upriv?.quitNow?.();
  const requestCloseNow = () => {
    if (asks) setConfirming(true);
    else closeNow();
  };
  const confirmCloseNow = (dontAskAgain: boolean) => {
    setConfirming(false);
    if (dontAskAgain) void patchSettings({ ui: { lifecycle_confirm_close_now: false } });
    closeNow();
  };

  const waiting = active && !now && items.length > 0;

  return (
    <>
      <Modal
        open={active}
        title={t(waiting ? "quit.work.title" : "quit.closing.title")}
        titleIcon={waiting ? "clock" : "lock"}
        onClose={() => {}}
        dismissible={false}
        panelClassName="max-w-md"
        footer={
          now ? undefined : (
            <div className="flex justify-end">
              <Button variant="danger" size="md" onClick={requestCloseNow}>
                {t("quit.close_now")}
              </Button>
            </div>
          )
        }
      >
        {waiting ? (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-on-surface-variant">{t("quit.work.body")}</p>
            <ul className="space-y-2">
              {items.map((item) => (
                <li
                  key={item.key}
                  className="flex items-center gap-3 rounded-xl bg-surface-container px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-on-surface">
                    {item.label}
                  </span>
                  <ElapsedTime startedAt={item.startedAt} layout="inline" />
                  <JobStopButton
                    size="sm"
                    stoppingSince={item.stoppingSince}
                    stoppable={item.stoppable}
                    onStop={item.stop}
                  />
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex flex-col items-center text-center" aria-busy="true">
            <span
              className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-accent/30 border-t-accent"
              aria-hidden
            />
            <p className="mt-4 text-sm text-on-surface-variant">
              {t(now ? "quit.closing.body_now" : "quit.closing.body")}
            </p>
            <ElapsedTime startedAt={startedAt} />
          </div>
        )}
      </Modal>
      <CloseNowModal
        target={confirming ? { kind: "quit" } : null}
        asks={asks}
        onCancel={() => setConfirming(false)}
        onConfirm={confirmCloseNow}
      />
    </>
  );
}
