import type { I18nKey } from "../../i18n/catalog";
import { deviceName, deviceSystemI18nKey, isPhoneSystem } from "../device";
import {
  APP_BACKUP_LIST,
  APP_UNLOCKED_LIST,
  DATA_FOLDER_LIST,
  selectionHere,
  selectionLabel,
  type DeviceGroups,
} from "../folder-lists";
import {
  vaultRootLogsDisplayPath,
  vaultRootUprivOpenPath,
  type AppDistribution,
} from "../vault-root";
import {
  loadingField,
  withOpenPath,
  type InfoField,
  type InfoSection,
  type InfoTranslate,
} from "../info";
import { formatBytes } from "../format/bytes";
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

const ROOT_SOURCE_KEYS = {
  explicit: "modal.info.value.root_source.explicit",
  row: "modal.info.value.root_source.row",
  default: "modal.info.value.root_source.default",
} as const;

/** Required WinFsp redistribution notice. Kept in English in every locale. */
const WINFSP_NOTICE = "WinFsp - Windows File System Proxy, Copyright (C) Bill Zissimopoulos";
const WINFSP_REPOSITORY = "https://github.com/winfsp/winfsp";

function yesNo(t: InfoTranslate, value: boolean): string {
  return t(value ? "modal.info.value.yes" : "modal.info.value.no");
}

function emptyDash(value: string | undefined | null): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "—";
}

/** Rows this device holds in a list. */
function rowsHere<F extends string>(groups: DeviceGroups<F>, id: string | null): number {
  return id ? (groups[id]?.rows.length ?? 0) : 0;
}

export function buildSystemInfoSections(
  snapshot: SystemInfoSnapshot,
  t: InfoTranslate,
): InfoSection[] {
  const {
    app,
    device,
    root,
    dataFolders,
    dataFolderBytes,
    inventory,
    ui,
    logging,
    unlockedFolders,
    backups,
    lastOpenedVault,
  } = snapshot;
  const here = device?.id ?? null;
  const groupHere = <F extends string>(groups: DeviceGroups<F>) =>
    here ? groups[here] : undefined;
  /** A row that needs `ready` read first: loading until then. */
  const once = (ready: boolean, id: string, label: string, value: () => string): InfoField =>
    ready ? { id, label, value: value() } : loadingField(id, label);
  const found = root?.status === "found" ? root : null;

  const dataFolderInUseLabel = t("modal.info.field.data_folder_in_use");
  const dataFolderInUse: InfoField =
    root && dataFolders && device
      ? {
          id: "data_folder_in_use",
          label: dataFolderInUseLabel,
          value:
            found?.source === "explicit"
              ? t("modal.info.value.root_source.explicit")
              : selectionLabel(
                  selectionHere(dataFolders.groups, here, DATA_FOLDER_LIST),
                  groupHere(dataFolders.groups),
                  t,
                ),
        }
      : loadingField("data_folder_in_use", dataFolderInUseLabel);
  const rowsHereLabel = t("modal.info.field.rows_here");
  const rowCounts: InfoField =
    dataFolders && device
      ? {
          id: "rows_here",
          label: rowsHereLabel,
          value: t("modal.info.value.rows_here", {
            data: rowsHere(dataFolders.groups, here),
            unlocked: rowsHere(unlockedFolders.devices, here),
            backups: rowsHere(backups.devices, here),
          }),
        }
      : loadingField("rows_here", rowsHereLabel);

  const appFields: InfoField[] = app
    ? [
        { id: "version", label: t("modal.info.field.version"), value: app.version },
        {
          id: "distribution",
          label: t("modal.info.field.distribution"),
          value: app.distribution != null ? t(DISTRIBUTION_KEYS[app.distribution]) : "—",
        },
        {
          id: "version_source",
          label: t("modal.info.field.version_source"),
          value: t(app.versionOffline ? "modal.info.value.offline" : "modal.info.value.online"),
        },
      ]
    : [
        loadingField("version", t("modal.info.field.version")),
        loadingField("distribution", t("modal.info.field.distribution")),
        loadingField("version_source", t("modal.info.field.version_source")),
      ];

  const deviceFields: InfoField[] = device
    ? [
        {
          id: "device_name",
          label: t("modal.info.field.device_name"),
          value: deviceName(device.id, device.system, snapshot.osNames, t),
        },
        {
          id: "device_system",
          label: t("modal.info.field.device_system"),
          value: t(deviceSystemI18nKey(device.system)),
        },
        {
          id: "device_os",
          label: t("modal.info.field.device_os"),
          value: device.os ?? t("modal.info.value.device_os.none"),
        },
        {
          id: "device_id",
          label: t("modal.info.field.device_id"),
          // The hashed ID itself: the key of this device's group in every list.
          value: device.id ?? t("modal.info.value.device_id.unknown"),
        },
      ]
    : [
        loadingField("device_name", t("modal.info.field.device_name")),
        loadingField("device_system", t("modal.info.field.device_system")),
        loadingField("device_os", t("modal.info.field.device_os")),
        loadingField("device_id", t("modal.info.field.device_id")),
      ];

  // Measured on its own, so a slow drive holds back this row alone.
  const sizeLabel = t("modal.info.field.data_folder_size");
  const sizeField: InfoField =
    dataFolderBytes === "measuring"
      ? loadingField("data_folder_size", sizeLabel)
      : {
          id: "data_folder_size",
          label: sizeLabel,
          value: formatBytes(dataFolderBytes ?? undefined),
        };

  const rootFields: InfoField[] = !root
    ? [
        loadingField("root_status", t("modal.info.field.root_status")),
        loadingField("root_path", t("modal.info.field.root_path")),
        sizeField,
      ]
    : root.status === "found"
      ? [
          {
            id: "root_status",
            label: t("modal.info.field.root_status"),
            value: t("modal.info.value.root_status.found"),
          },
          withOpenPath(
            { id: "root_path", label: t("modal.info.field.root_path"), value: root.rootPath },
            root.rootPath,
          ),
          {
            id: "root_source",
            label: t("modal.info.field.root_source"),
            value: t(ROOT_SOURCE_KEYS[root.source]),
          },
          sizeField,
        ]
      : [
          {
            id: "root_status",
            label: t("modal.info.field.root_status"),
            value: t("modal.info.value.root_status.needs_setup"),
          },
        ];

  return [
    {
      id: "app",
      title: t("modal.info.section.app"),
      fields: [
        ...appFields,
        ...(device?.system === "windows"
          ? [
              {
                id: "winfsp",
                label: t("modal.info.field.winfsp"),
                value: WINFSP_NOTICE,
                href: WINFSP_REPOSITORY,
              },
            ]
          : []),
      ],
    },
    {
      id: "this_device",
      title: t("modal.info.section.this_device"),
      fields: deviceFields,
    },
    {
      id: "data_folder",
      title: t("modal.info.section.data_folder"),
      fields: [dataFolderInUse, ...rootFields, rowCounts],
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
          id: "lifecycle_open_file_manager_on_open",
          label: t("modal.info.field.lifecycle_open_file_manager_on_open"),
          value: yesNo(t, ui.lifecycle_open_file_manager_on_open),
        },
        {
          id: "lifecycle_keep_open_on_wake",
          label: t("modal.info.field.lifecycle_keep_open_on_wake"),
          value: yesNo(t, ui.lifecycle_keep_open_on_wake),
        },
        {
          id: "lifecycle_confirm_close_now",
          label: t("modal.info.field.lifecycle_confirm_close_now"),
          value: yesNo(t, ui.lifecycle_confirm_close_now),
        },
        {
          id: "lifecycle_confirm_stop",
          label: t("modal.info.field.lifecycle_confirm_stop"),
          value: yesNo(t, ui.lifecycle_confirm_stop),
        },
        {
          id: "lifecycle_confirm_lock",
          label: t("modal.info.field.lifecycle_confirm_lock"),
          value: yesNo(t, ui.lifecycle_confirm_lock),
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
      id: "folders",
      title: t("modal.info.section.folders"),
      fields: [
        once(
          device !== null,
          "unlocked_folder_in_use",
          t("modal.info.field.unlocked_folder_in_use"),
          () =>
            selectionLabel(
              selectionHere(unlockedFolders.devices, here, APP_UNLOCKED_LIST),
              groupHere(unlockedFolders.devices),
              t,
            ),
        ),
        // A phone mounts no encrypted vault's folder, so it has no row.
        ...(device && isPhoneSystem(device.system)
          ? []
          : [
              {
                id: "encrypted_vaults_folder",
                label: t("modal.info.field.encrypted_vaults_folder"),
                value: yesNo(t, unlockedFolders.encrypted_vaults),
              },
            ]),
        once(
          device !== null,
          "backup_folder_in_use",
          t("modal.info.field.backup_folder_in_use"),
          () =>
            selectionLabel(
              selectionHere(backups.devices, here, APP_BACKUP_LIST),
              groupHere(backups.devices),
              t,
            ),
        ),
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
        // The app home holds the data folder list; on a computer it is Default's folder.
        dataFolders
          ? withOpenPath(
              {
                id: "app_home",
                label: t("modal.info.field.app_home"),
                value: dataFolders.defaultFolder ?? "—",
              },
              dataFolders.defaultFolder,
            )
          : loadingField("app_home", t("modal.info.field.app_home")),
        root === null
          ? loadingField("logs_path", t("modal.info.field.logs_path"))
          : withOpenPath(
              {
                id: "logs_path",
                label: t("modal.info.field.logs_path"),
                value: found ? vaultRootLogsDisplayPath(found.rootPath) : "—",
              },
              found ? vaultRootUprivOpenPath(found.rootPath, "logs") : null,
            ),
      ],
    },
  ];
}
