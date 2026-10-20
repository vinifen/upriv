# Radio choices that need another step

One pattern for every `PolicyRadioOption` group, desktop and mobile.

## Rules

1. **Choosing an option opens nothing.** No folder picker, file picker, or dialog runs from `onSelect`. The option's own controls (Choose folder, Browse…) do that.
2. **A chosen option that still lacks its step wears `attention`** (the yellow border): a folder not set yet, a path that is not absolute, a name that cannot be used, a data folder that needs a replace choice or is unreadable, a driver to install, a password not checked. Pass `attention` only for the missing step; `PolicyRadioOption` shows it only while the option is checked.
3. **The primary action waits** (Continue, Apply, Export, Save, Create) while that step is missing. The section reports it the usual way: the gate's `blocksPrimary`, a workspace path issue (`empty` for a folder option chosen without a path), a create-wizard field error, or the export's `dataFolderExportPending`.
4. **Not while a check runs.** A disk check or a zip probe in flight is `checking` / pending: no attention yet, the primary still waits.
5. **The choice survives an empty field.** Clearing a path does not jump back to another option. App rows keep `place: "custom"`; vault rows use the draft mark from `vaultFolderRow("")` (`vaultFolderChosen`). Neither reaches disk with an empty path: validation holds Save.
6. **Folder paths are editable text on desktop** (`PathField` with `onChange`, placeholder `modal.folder_field.placeholder`), beside a Choose folder button that keeps working, and the reveal button inside the field. Keep the text as typed (trim only when it is saved or sent). A typed vault-root path is checked after `VAULT_ROOT_PATH_CHECK_DELAY_MS`, reading `checking` from the first key.
7. **Phones pick folders.** On Android a folder is a storage-access grant, and a typed path is not one, so mobile folder fields that need a grant stay picker-only. Rules 1–5 still apply.
8. **Windows start with the first option chosen** when that option needs no extra step (Data folder: the folder in use; "Where should the files go?": Default workspace).

## Do not

- Call `pickFolder` (or any picker) from `onSelect`.
- Flip a chosen folder option back to "unset" / "inherit" because its path was cleared.
- Trim a path on every keystroke (spaces inside folder names disappear).
- Mark `attention` on an option that is not the one missing the step.
