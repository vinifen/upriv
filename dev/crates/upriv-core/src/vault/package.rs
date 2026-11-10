//! The package every vault archive holds: one folder named like the archive
//! file, which carries the vault's name as the person typed it, holding one
//! folder named after the vault's id, which holds the vault
//! (`My notes-upriv/my-notes/…`). Import names the new vault after the name
//! its settings carry ([`imported_vault_name`]), so the archive file can be
//! renamed (`My notes-upriv-2.zip`) and the vault keeps its name.
//!
//! The vault folder holds the vault's own files and nothing else. What an
//! export carries about the vault, the `.upriv-config/` of a `.7z` or a
//! plain-text `.zip`, sits beside it in the package folder
//! (`My notes-plain-text/.upriv-config/`).
//!
//! A store zip, a backup zip, a `.7z`, and a plain-text `.zip` are packages.
//! A `.zip` of documents Upriv did not write may hold anything: it is a
//! package only when it has that shape.

use crate::paths::vault_folder_name;

use crate::store::EXPORT_CONFIG_DIR;

/// What an export holds, as its file and package folder say.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PackageKind {
    /// A `.zip` of `store/`: the vault's ciphertext.
    Store,
    /// A plain-text `.zip`: the vault's readable files.
    PlainText,
    /// A `.7z` of the vault's readable files.
    SevenZip,
}

impl PackageKind {
    fn suffix(self) -> &'static str {
        match self {
            Self::Store => "upriv",
            Self::PlainText => "plain-text",
            Self::SevenZip => "sevenzip",
        }
    }

    pub(crate) fn extension(self) -> &'static str {
        match self {
            Self::Store | Self::PlainText => "zip",
            Self::SevenZip => "7z",
        }
    }
}

/// The name an export of `display_name` as `kind` starts from, before its
/// number and extension: `Notes-upriv` (`vaultExportFilename` in
/// `@upriv/shared`).
pub(crate) fn export_stem(display_name: &str, kind: PackageKind) -> String {
    format!("{}-{}", vault_folder_name(display_name), kind.suffix())
}

/// The two folders of a package.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Package {
    /// Named like the archive file, without its extension.
    pub(crate) outer: String,
    /// Named after the vault's id.
    pub(crate) vault: String,
}

impl Package {
    /// The package of the archive file `stem` plus its extension, holding the
    /// vault `vault_id`.
    pub(crate) fn new(stem: &str, vault_id: &str) -> Self {
        Self {
            outer: stem.to_string(),
            vault: vault_id.to_string(),
        }
    }

    /// The folder the vault's own files sit in: `My notes-upriv/my-notes`.
    pub(crate) fn root(&self) -> String {
        format!("{}/{}", self.outer, self.vault)
    }

    /// `path` under the vault folder (a vault path, its leading `/` dropped)
    /// as an archive member: `My notes-upriv/my-notes/docs/a.txt`.
    pub(crate) fn member(&self, path: &str) -> String {
        format!("{}/{}", self.root(), path.trim_start_matches('/'))
    }

    /// The path under the vault folder that the member `name` is (`/` as its
    /// separator), or `None` for the package's folders and anything outside
    /// the vault folder.
    pub(crate) fn inside<'a>(&self, name: &'a str) -> Option<&'a str> {
        self.under(name, &self.vault)
    }

    /// The path under `.upriv-config/`, beside the vault folder, that the
    /// member `name` is, or `None` for anything else.
    pub(crate) fn config<'a>(&self, name: &'a str) -> Option<&'a str> {
        self.under(name, EXPORT_CONFIG_DIR)
    }

    /// `path`, relative to the package folder, as an archive member beside
    /// the vault folder: `My notes-upriv/.upriv-config/config.toml`.
    pub(crate) fn beside(&self, path: &str) -> String {
        format!("{}/{}", self.outer, path.trim_start_matches('/'))
    }

    fn under<'a>(&self, name: &'a str, folder: &str) -> Option<&'a str> {
        let rest = name
            .trim_start_matches('/')
            .strip_prefix(self.outer.as_str())?
            .strip_prefix('/')?
            .strip_prefix(folder)?
            .strip_prefix('/')?
            .trim_end_matches('/');
        (!rest.is_empty()).then_some(rest)
    }

    /// The package the archive members `members` (name, is a folder) form,
    /// when they form one. What a system leaves in an archive (`__MACOSX`,
    /// `.DS_Store`) does not count.
    pub(crate) fn find<'a>(members: impl IntoIterator<Item = (&'a str, bool)>) -> Option<Self> {
        let mut walk = PackageWalk::default();
        for (name, is_dir) in members {
            let name = name.replace('\\', "/");
            if name.trim_matches('/').is_empty() || is_os_junk(&name) {
                continue;
            }
            walk.place(&name, is_dir).ok()?;
        }
        walk.package()
    }

    /// [`Self::find`] over zip entry names, where a folder ends with `/`.
    pub(crate) fn find_in_zip<'a>(names: impl IntoIterator<Item = &'a str>) -> Option<Self> {
        Self::find(names.into_iter().map(|name| (name, name.ends_with('/'))))
    }
}

/// The name a vault made from an archive takes: the name the settings it
/// carries hold, as the person typed it, or else the name of its package's
/// vault folder, the id of the vault it came from.
pub(crate) fn imported_vault_name(carried: Option<&str>, package: &Package) -> String {
    carried
        .filter(|name| !name.trim().is_empty())
        .map_or_else(|| package.vault.clone(), str::to_string)
}

/// Where a member of a package sits.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Placed {
    /// The package folder, its vault folder, or its `.upriv-config/`.
    Folder,
    /// A path under the vault folder: one of the vault's files or folders.
    Vault(String),
    /// A path under `.upriv-config/`, beside the vault folder.
    Config(String),
}

/// The members of an archive met one by one, as a `.7z` stream gives them.
#[derive(Debug, Default)]
pub(crate) struct PackageWalk {
    outer: Option<String>,
    vault: Option<String>,
}

impl PackageWalk {
    /// Where the member `name` sits. `Err` says how it breaks the package.
    pub(crate) fn place(
        &mut self,
        name: &str,
        is_dir: bool,
    ) -> std::result::Result<Placed, &'static str> {
        let parts: Vec<&str> = name.split('/').filter(|part| !part.is_empty()).collect();
        let Some(outer) = parts.first() else {
            return Err("an archive member has no name");
        };
        if parts.iter().any(|part| *part == "." || *part == "..") {
            return Err("an archive member leaves its folder");
        }
        if !same(&mut self.outer, outer) {
            return Err("the archive must hold one folder");
        }
        match parts.len() {
            1 if is_dir => Ok(Placed::Folder),
            1 => Err("a file sits beside the package folder"),
            2 if !is_dir => Err("a file sits beside the vault folder"),
            2 if parts[1] == EXPORT_CONFIG_DIR => Ok(Placed::Folder),
            _ if parts[1] == EXPORT_CONFIG_DIR => Ok(Placed::Config(parts[2..].join("/"))),
            _ if !same(&mut self.vault, parts[1]) => {
                Err("the package folder must hold one vault folder")
            }
            2 => Ok(Placed::Folder),
            _ => Ok(Placed::Vault(parts[2..].join("/"))),
        }
    }

    /// The package, once a vault folder was met.
    pub(crate) fn package(self) -> Option<Package> {
        Some(Package {
            outer: self.outer?,
            vault: self.vault?,
        })
    }
}

fn same(slot: &mut Option<String>, part: &str) -> bool {
    match slot {
        Some(current) => current == part,
        None => {
            *slot = Some(part.to_string());
            true
        }
    }
}

/// A folder or file a system leaves in an archive: `__MACOSX`, `.DS_Store`.
pub(crate) fn is_os_junk(name: &str) -> bool {
    name.split(['/', '\\'])
        .any(|part| part == "__MACOSX" || part == ".DS_Store")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_export_is_named_after_the_vault_and_holds_its_id() {
        assert_eq!(export_stem("Notes", PackageKind::Store), "Notes-upriv");
        assert_eq!(
            export_stem("Notes: 2026", PackageKind::PlainText),
            "Notes_ 2026-plain-text"
        );
        assert_eq!(export_stem("CON", PackageKind::SevenZip), "vault-sevenzip");
        let package = Package::new("Notes_ 2026-upriv-2", "notes-2026");
        assert_eq!(package.root(), "Notes_ 2026-upriv-2/notes-2026");
        assert_eq!(
            package.member("a/b.txt"),
            "Notes_ 2026-upriv-2/notes-2026/a/b.txt"
        );
    }

    #[test]
    fn an_import_takes_the_name_its_settings_carry_or_else_the_vault_folder() {
        let package = Package::new("My notes-upriv-2", "my-notes");
        assert_eq!(
            imported_vault_name(Some("My notes: 2026"), &package),
            "My notes: 2026"
        );
        assert_eq!(imported_vault_name(None, &package), "my-notes");
        assert_eq!(imported_vault_name(Some("  "), &package), "my-notes");
    }

    #[test]
    fn a_package_is_one_folder_holding_one_vault_folder() {
        let found = Package::find_in_zip([
            "Notes-upriv/",
            "Notes-upriv/Notes/",
            "Notes-upriv/Notes/config.toml",
            "Notes-upriv/Notes/store/header/vault.header",
            "__MACOSX/Notes-upriv/._config.toml",
        ])
        .unwrap();
        assert_eq!(found, Package::new("Notes-upriv", "Notes"));
        assert_eq!(found.inside("Notes-upriv/Notes/store/x"), Some("store/x"));
        assert_eq!(found.inside("Notes-upriv/Notes/"), None);
        assert_eq!(found.inside("Notes-upriv/"), None);
        assert_eq!(found.inside("Other/Notes/a"), None);
        assert_eq!(found.inside("Notes-upriv/Notesx/a"), None);
        // An empty vault is the two folders.
        assert_eq!(
            Package::find([("P", true), ("P/V", true)]),
            Some(Package::new("P", "V"))
        );
    }

    #[test]
    fn the_settings_folder_sits_beside_the_vault_folder() {
        let found = Package::find_in_zip([
            "P/.upriv-config/config.toml",
            "P/.upriv-config/README.md",
            "P/v/notes.txt",
        ])
        .unwrap();
        assert_eq!(found, Package::new("P", "v"));
        assert_eq!(
            found.config("P/.upriv-config/config.toml"),
            Some("config.toml")
        );
        assert_eq!(found.config("P/.upriv-config/"), None);
        assert_eq!(found.config("P/v/.upriv-config/config.toml"), None);
        assert_eq!(found.inside("P/.upriv-config/config.toml"), None);
        assert_eq!(
            found.beside(".upriv-config/config.toml"),
            "P/.upriv-config/config.toml"
        );
        // That folder alone names no vault folder.
        assert_eq!(Package::find_in_zip(["P/.upriv-config/config.toml"]), None);
    }

    #[test]
    fn anything_else_is_no_package() {
        for names in [
            &["Notes/a.txt"][..],
            &["a.txt", "Notes/V/b.txt"],
            &["P/", "P/a.txt", "P/V/b.txt"],
            &["P/V/a.txt", "P/W/b.txt"],
            &["P/V/a.txt", "Q/V/b.txt"],
            &["P/"],
            &["P/../V/a.txt"],
            &["P/.upriv-config", "P/V/a.txt"],
        ] {
            assert_eq!(
                Package::find_in_zip(names.iter().copied()),
                None,
                "{names:?}"
            );
        }
    }

    #[test]
    fn a_walk_places_each_member_as_it_comes() {
        let mut walk = PackageWalk::default();
        assert_eq!(walk.place("P", true), Ok(Placed::Folder));
        assert_eq!(walk.place("P/.upriv-config", true), Ok(Placed::Folder));
        assert_eq!(
            walk.place("P/.upriv-config/config.toml", false),
            Ok(Placed::Config("config.toml".into()))
        );
        assert_eq!(walk.place("P/V", true), Ok(Placed::Folder));
        assert_eq!(
            walk.place("P/V/docs/a.txt", false),
            Ok(Placed::Vault("docs/a.txt".into()))
        );
        assert!(walk.place("P/W/b.txt", false).is_err());
        assert!(walk.place("Q/V/b.txt", false).is_err());
        assert!(walk.place("P/stray.txt", false).is_err());
        assert_eq!(walk.package(), Some(Package::new("P", "V")));
        assert_eq!(PackageWalk::default().package(), None);
    }
}
