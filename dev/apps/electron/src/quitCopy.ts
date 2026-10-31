/** Quit dialog text shown by Electron main while a vault is open. */
export interface QuitCopy {
  message: string;
  confirm: string;
  now: string;
  cancel: string;
}

/**
 * The `warning.vault_open_on_exit*` keys of the shared locales. Main is not
 * bundled with them, so the text lives here and a test holds it equal.
 */
export const QUIT_COPY: Record<string, QuitCopy> = {
  en: {
    message:
      "A vault is still open. Close and quit saves everything and writes the backup. Close now quits in seconds, with no backup and no overwrite of plain-text folders, and loses changes not saved yet.",
    confirm: "Close and quit",
    now: "Close now",
    cancel: "Cancel",
  },
  "pt-BR": {
    message:
      "Um cofre ainda está aberto. Fechar e sair salva tudo e grava o backup. Fechar agora sai em segundos, sem backup e sem sobrescrever pastas de texto puro, e perde as alterações ainda não salvas.",
    confirm: "Fechar e sair",
    now: "Fechar agora",
    cancel: "Cancelar",
  },
  es: {
    message:
      "Una bóveda sigue abierta. Cerrar y salir guarda todo y escribe la copia de seguridad. Cerrar ahora sale en segundos, sin copia de seguridad y sin sobrescribir carpetas en texto plano, y pierde los cambios aún no guardados.",
    confirm: "Cerrar y salir",
    now: "Cerrar ahora",
    cancel: "Cancelar",
  },
};

export function quitCopyForLocale(locale: string): QuitCopy {
  return QUIT_COPY[locale] ?? QUIT_COPY.en;
}
