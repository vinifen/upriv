# Radio choices that need another step

One pattern for every `PolicyRadioOption` group, desktop and mobile.

## Rules

1. **Choosing an option opens nothing.** No folder picker, file picker, or dialog runs from `onSelect`. The option's own controls (Choose folder, Browse…) do that.
2. **An option's own controls always show.** Pass its `footer` whether or not it is chosen; never swap it for `undefined` while another option is chosen. Until it is chosen the footer is dimmed and every control in it is disabled (desktop: a disabled `fieldset`, keyboard included; mobile: no touch and hidden from accessibility), and a click or tap on it chooses the option.
3. **A chosen option that still lacks its step wears `attention`** (the yellow border): a folder not set yet, a path that is not absolute, a name that cannot be used, a data folder that needs a replace choice or is unreadable, a driver to install. A password the primary action checks itself (the vault `.7z` export) is missing until it is typed, and again once it is refused, until it is edited. Pass `attention` only for the missing step; `PolicyRadioOption` shows it only while the option is checked.
4. **The primary action waits** (Continue, Apply, Export, Save, Create) while that step is missing. The section reports it the usual way: the gate's `blocksPrimary`, a workspace path issue (`empty` for a folder option chosen without a path), a create-wizard field error, or the export's `dataFolderExportPending` / `vaultExportPending`.
5. **Not while a check runs.** A disk check or a zip probe in flight is `checking` / pending: no attention yet, the primary still waits.
6. **The choice survives an empty field.** Clearing a path does not jump back to another option. App rows keep `place: "custom"`; vault rows use the draft mark from `vaultFolderRow("")` (`vaultFolderChosen`). Neither reaches disk with an empty path: validation holds Save.
7. **Folder paths are editable text on desktop** (`PathField` with `onChange`, placeholder `modal.folder_field.placeholder`), beside a Choose folder button that keeps working, and the reveal button inside the field. Keep the text as typed (trim only when it is saved or sent). A typed vault-root path is checked after `VAULT_ROOT_PATH_CHECK_DELAY_MS`, reading `checking` from the first key. An export's folder is the `ExportFolderField`.
8. **Phones pick folders.** On Android a folder is a storage-access grant, and a typed path is not one, so mobile folder fields that need a grant stay picker-only. Rules 1–6 still apply.
9. **Windows start with the first option chosen** when that option needs no extra step (Data folder: the folder in use; "Where should the files go?": Default workspace).
10. **Enter moves to the next step.** In a field before an export folder (the vault `.7z` password, the Export a copy name), Enter (Return on a phone) stays put while that field's own step is missing. While the folder is missing it opens the picker (`chooseIfMissing`): desktop also puts the cursor in the folder field, so a cancelled pick can be typed. Once nothing is missing it runs the primary action.

## Do not

- Call `pickFolder` (or any picker) from `onSelect`, or open a save dialog from the primary action: the folder is the option's step.
- Hide an option's controls until it is chosen (`footer={checked ? … : undefined}`).
- Flip a chosen folder option back to "unset" / "inherit" because its path was cleared.
- Trim a path on every keystroke (spaces inside folder names disappear).
- Mark `attention` on an option that is not the one missing the step.
