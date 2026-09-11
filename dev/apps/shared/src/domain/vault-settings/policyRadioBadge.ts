import type { I18nKey } from "../../i18n/catalog";

/** Visual badge on a `PolicyRadioOption` (kebab in the prop, snake in i18n). */
export type PolicyRadioBadge =
  "recommended" | "less-secure" | "insecure" | "default" | "more-secure";

/** Prop value → catalog key. One table so desktop and mobile cannot drift. */
export const POLICY_RADIO_BADGE_I18N = {
  recommended: "modal.settings.badge.recommended",
  "less-secure": "modal.settings.badge.less_secure",
  insecure: "modal.settings.badge.insecure",
  default: "modal.settings.badge.default",
  "more-secure": "modal.settings.badge.more_secure",
} as const satisfies Record<PolicyRadioBadge, I18nKey>;
