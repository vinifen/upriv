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
      "A vault is still open. Close it before exiting, or quit now and recover it next time?",
    confirm: "Close and quit",
    now: "Just close",
    cancel: "Cancel",
  },
  "pt-BR": {
    message:
      "Um cofre ainda está aberto. Fechar antes de sair, ou sair agora e recuperar na próxima vez?",
    confirm: "Fechar e sair",
    now: "Só sair",
    cancel: "Cancelar",
  },
  es: {
    message:
      "Una bóveda sigue abierta. ¿Cerrarla antes de salir, o salir ahora y recuperarla la próxima vez?",
    confirm: "Cerrar y salir",
    now: "Solo salir",
    cancel: "Cancelar",
  },
};

export function quitCopyForLocale(locale: string): QuitCopy {
  return QUIT_COPY[locale] ?? QUIT_COPY.en;
}
