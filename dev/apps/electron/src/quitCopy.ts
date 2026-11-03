/** Quit dialog text shown by Electron main while a vault is open or work runs. */
export interface QuitCopy {
  message: string;
  /** No vault is open, but an export, an import, or other work still runs. */
  workMessage: string;
  confirm: string;
  now: string;
  cancel: string;
}

/**
 * The `warning.vault_open_on_exit*` and `warning.work_running_on_exit` keys of
 * the shared locales. Main is not bundled with them, so the text lives here
 * and a test holds it equal.
 */
export const QUIT_COPY: Record<string, QuitCopy> = {
  en: {
    message:
      "A vault is still open. Close and quit saves everything and writes the backup. Close now quits in seconds, with no backup and no overwrite of plain-text folders, and loses changes not saved yet.",
    workMessage:
      "Work is still running. Close and quit waits for it to end, and you can stop each one. Close now stops it all and quits in seconds; nothing it started is kept.",
    confirm: "Close and quit",
    now: "Close now",
    cancel: "Cancel",
  },
  "pt-BR": {
    message:
      "Um cofre ainda está aberto. Fechar e sair salva tudo e grava o backup. Fechar agora sai em segundos, sem backup e sem sobrescrever pastas de texto puro, e perde as alterações ainda não salvas.",
    workMessage:
      "Ainda há trabalho em andamento. Fechar e sair espera terminar, e você pode parar cada um. Fechar agora para tudo e sai em segundos; nada do que começou é mantido.",
    confirm: "Fechar e sair",
    now: "Fechar agora",
    cancel: "Cancelar",
  },
  es: {
    message:
      "Una bóveda sigue abierta. Cerrar y salir guarda todo y escribe la copia de seguridad. Cerrar ahora sale en segundos, sin copia de seguridad y sin sobrescribir carpetas en texto plano, y pierde los cambios aún no guardados.",
    workMessage:
      "Todavía hay trabajo en curso. Cerrar y salir espera a que termine, y puedes detener cada uno. Cerrar ahora lo detiene todo y sale en segundos; no se conserva nada de lo que empezó.",
    confirm: "Cerrar y salir",
    now: "Cerrar ahora",
    cancel: "Cancelar",
  },
};

export function quitCopyForLocale(locale: string): QuitCopy {
  return QUIT_COPY[locale] ?? QUIT_COPY.en;
}
