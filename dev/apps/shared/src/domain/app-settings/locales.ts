import type { LocaleId } from "./types";

export const DEFAULT_LOCALE: LocaleId = "en";

export const SUPPORTED_LOCALES: readonly LocaleId[] = ["en", "pt-BR", "es"] as const;
