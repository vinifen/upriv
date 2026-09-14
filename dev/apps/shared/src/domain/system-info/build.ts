import type { I18nKey } from "../../i18n/catalog";
import type { AppDistribution } from "../vault-root";
import type { InfoSection, InfoTranslate } from "../info";
import type { SystemInfoSnapshot } from "./types";

const DISTRIBUTION_KEYS: Record<AppDistribution, I18nKey> = {
  portable: "modal.help.distribution.portable",
  installed: "modal.help.distribution.installed",
  dev: "modal.help.distribution.dev",
};

const LOCALE_KEYS = {
  en: "modal.app_settings.option.locale.en",
  "pt-BR": "modal.app_settings.option.locale.pt-BR",
  es: "modal.app_settings.option.locale.es",
} as const;

const THEME_KEYS = {
  dark: "modal.app_settings.option.theme.dark",
  neutral: "modal.app_settings.option.theme.neutral",
  light: "modal.app_settings.option.theme.light",
} as const;

const SORT_MODE_KEYS = {
  order: "vault.list.sort.mode.order",
  name: "vault.list.sort.mode.name",
  state: "vault.list.sort.mode.state",
  last_accessed: "vault.list.sort.mode.last_accessed",
  groups: "vault.list.sort.mode.groups",
} as const;

const SORT_DIR_KEYS = {
  asc: "vault.list.sort.direction.asc",
  desc: "vault.list.sort.direction.desc",
} as const;

const VIEW_MODE_KEYS = {
  default: "vault.list.view.mode.default",
  large: "vault.list.view.mode.large",
  compact: "vault.list.view.mode.compact",
  blocks: "vault.list.view.mode.blocks",
} as const;

const ROOT_MODE_KEYS = {
  default_root: "modal.info.value.root_mode.default",
  custom_root: "modal.info.value.root_mode.custom",
} as const;

const ROOT_SOURCE_KEYS = {
  explicit: "modal.info.value.root_source.explicit",
  custom_root: "modal.info.value.root_source.custom",
  default_root: "modal.info.value.root_source.default",
} as const;

function yesNo(t: InfoTranslate, value: boolean): string {
  return t(value ? "modal.info.value.yes" : "modal.info.value.no");
}

function emptyDash(value: string | undefined | null): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "—";
}

export function buildSystemInfoSections(
  snapshot: SystemInfoSnapshot,
  t: InfoTranslate,
): InfoSection[] {
  const { app, root, rootMode, inventory, ui, logging, workspace, lastOpenedVault, paths } =
    snapshot;

  const distribution = app.distribution != null ? t(DISTRIBUTION_KEYS[app.distribution]) : "—";

  const rootFields =
    root.status === "found"
      ? [
          {
            id: "root_status",
            label: t("modal.info.field.root_status"),
            value: t("modal.info.value.root_status.found"),
          },
          { id: "root_path", label: t("modal.info.field.root_path"), value: root.rootPath },
          {
            id: "root_source",
            label: t("modal.info.field.root_source"),
            value: t(ROOT_SOURCE_KEYS[root.source]),
          },
        ]
      : [
          {
            id: "root_status",
            label: t("modal.info.field.root_status"),
            value: t("modal.info.value.root_status.needs_setup"),
          },
          {
            id: "default_root_anchor",
            label: t("modal.info.field.default_root_anchor"),
            value: root.defaultRootAnchor,
          },
          { id: "alias_path", label: t("modal.info.field.alias_path"), value: root.aliasPath },
          {
            id: "distribution",
            label: t("modal.info.field.distribution"),
            value: t(DISTRIBUTION_KEYS[root.distribution]),
          },
        ];

  return [
    {
      id: "app",
      title: t("modal.info.section.app"),
      fields: [
        { id: "version", label: t("modal.info.field.version"), value: app.version },
        { id: "distribution", label: t("modal.info.field.distribution"), value: distribution },
        {
          id: "version_source",
          label: t("modal.info.field.version_source"),
          value: t(app.versionOffline ? "modal.info.value.offline" : "modal.info.value.online"),
        },
      ],
    },
    {
      id: "data_folder",
      title: t("modal.info.section.data_folder"),
      fields: [
        {
          id: "root_mode",
          label: t("modal.info.field.root_mode"),
          value: t(ROOT_MODE_KEYS[rootMode]),
        },
        ...rootFields,
      ],
    },
    {
      id: "inventory",
      title: t("modal.info.section.inventory"),
      fields: [
        {
          id: "vaults_total",
          label: `${t("modal.info.field.vaults_total")} · ${t("modal.info.field.vaults_total_excludes_hidden")}`,
          value: String(inventory.vaultsTotal),
        },
        {
          id: "vaults_open",
          label: t("modal.info.field.vaults_open"),
          value: String(inventory.vaultsOpen),
        },
        {
          id: "groups_total",
          label: `${t("modal.info.field.groups_total")} · ${t("modal.info.field.groups_total_excludes_hidden")}`,
          value: String(inventory.groupsTotal),
        },
      ],
    },
    {
      id: "preferences",
      title: t("modal.info.section.preferences"),
      fields: [
        { id: "locale", label: t("modal.info.field.locale"), value: t(LOCALE_KEYS[ui.locale]) },
        { id: "theme", label: t("modal.info.field.theme"), value: t(THEME_KEYS[ui.theme]) },
        {
          id: "sort",
          label: t("modal.info.field.sort"),
          value: `${t(SORT_MODE_KEYS[ui.vault_list_sort])} · ${t(SORT_DIR_KEYS[ui.vault_list_sort_direction])}`,
        },
        {
          id: "view",
          label: t("modal.info.field.view"),
          value: t(VIEW_MODE_KEYS[ui.vault_list_view]),
        },
        {
          id: "search_query",
          label: t("modal.info.field.search_query"),
          value: emptyDash(ui.vault_list_search),
        },
        {
          id: "show_create_button",
          label: t("modal.info.field.show_create_button"),
          value: yesNo(t, ui.vault_list_show_create_button),
        },
        {
          id: "show_search_button",
          label: t("modal.info.field.show_search_button"),
          value: yesNo(t, ui.vault_list_show_search_button),
        },
        {
          id: "show_sort_button",
          label: t("modal.info.field.show_sort_button"),
          value: yesNo(t, ui.vault_list_show_sort_button),
        },
        {
          id: "show_view_button",
          label: t("modal.info.field.show_view_button"),
          value: yesNo(t, ui.vault_list_show_view_button),
        },
        {
          id: "show_header_more_button",
          label: t("modal.info.field.show_header_more_button"),
          value: yesNo(t, ui.vault_list_show_header_more_button),
        },
        {
          id: "show_vault_more_button",
          label: t("modal.info.field.show_vault_more_button"),
          value: yesNo(t, ui.vault_list_show_vault_more_button),
        },
        {
          id: "show_vault_settings_button",
          label: t("modal.info.field.show_vault_settings_button"),
          value: yesNo(t, ui.vault_list_show_vault_settings_button),
        },
        {
          id: "show_group_settings_button",
          label: t("modal.info.field.show_group_settings_button"),
          value: yesNo(t, ui.vault_list_show_group_settings_button),
        },
        {
          id: "vault_list_show_drag",
          label: t("modal.info.field.vault_list_show_drag"),
          value: yesNo(t, ui.vault_list_show_drag),
        },
        {
          id: "vault_list_allow_drag_into_group",
          label: t("modal.info.field.vault_list_allow_drag_into_group"),
          value: yesNo(t, ui.vault_list_allow_drag_into_group),
        },
        {
          id: "file_manager_dock_expanded",
          label: t("modal.info.field.file_manager_dock_expanded"),
          value: yesNo(t, ui.file_manager_dock_expanded),
        },
        {
          id: "lifecycle_close_modal_on_submit",
          label: t("modal.info.field.lifecycle_close_modal_on_submit"),
          value: yesNo(t, ui.lifecycle_close_modal_on_submit),
        },
        {
          id: "always_show_hidden_vaults",
          label: t("modal.info.field.always_show_hidden_vaults"),
          value: yesNo(t, ui.always_show_hidden_vaults),
        },
      ],
    },
    {
      id: "logging",
      title: t("modal.info.section.logging"),
      fields: [
        {
          id: "logging_enabled",
          label: t("modal.info.field.logging_enabled"),
          value: yesNo(t, logging.enabled),
        },
        {
          id: "log_level",
          label: t("modal.info.field.log_level"),
          value: logging.level.toUpperCase(),
        },
        {
          id: "log_entries_per_file",
          label: t("modal.info.field.log_entries_per_file"),
          value: String(logging.entries_per_file),
        },
        {
          id: "log_keep_last",
          label: t("modal.info.field.log_keep_last"),
          value: String(logging.keep_last_entries),
        },
      ],
    },
    {
      id: "workspace",
      title: t("modal.info.section.workspace"),
      fields: [
        {
          id: "workspace_global_path",
          label: t("modal.info.field.workspace_global_path"),
          value: emptyDash(workspace.path),
        },
        {
          id: "last_opened_vault",
          label: t("modal.app_settings.field.last_opened_vault"),
          value: emptyDash(lastOpenedVault),
        },
      ],
    },
    {
      id: "paths",
      title: t("modal.info.section.paths"),
      fields: [
        { id: "app_home", label: t("modal.info.field.app_home"), value: paths.appHome },
        { id: "logs_path", label: t("modal.info.field.logs_path"), value: paths.logsDir },
      ],
    },
  ];
}
