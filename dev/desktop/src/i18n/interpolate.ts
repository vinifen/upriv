import type { I18nParams } from "./types";

/** Replace `{name}` placeholders in catalog values (LOCALE.md). */
export function interpolate(template: string, params?: I18nParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in params ? String(params[key]) : `{${key}}`,
  );
}
