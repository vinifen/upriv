//! Allocate vault/group slug ids from a display name (parity with TS `displayNameToVaultId`).
//!
//! JS: `normalize("NFD")` + strip `\p{Diacritic}` + lower + `[^a-z0-9]` → hyphen.
//! After NFD, Latin diacritics are combining marks (canonical class ≠ 0); dropping
//! those matches JS `\p{Diacritic}` for vault names. Letters that do **not**
//! NFD-decompose (`ø`, `ł`, `ı`, `đ`, `ħ`, `ŧ`, `ŀ`, `ß`) become hyphens — same as
//! JS. Create allocates the id in TS; `vault_rename` must produce the same slug
//! or a later rename migrates the folder.

use unicode_normalization::char::canonical_combining_class;
use unicode_normalization::UnicodeNormalization;

use super::slug_id_is_valid;

fn keep_slug_char(c: char) -> bool {
    canonical_combining_class(c) == 0
}

/// Slug base from a display name (no collision suffix). Empty → `"vault"`.
pub fn display_name_to_slug_base(display_name: &str) -> String {
    let mut out = String::new();
    let mut pending_hyphen = false;
    for c in display_name.nfd() {
        if !keep_slug_char(c) {
            continue;
        }
        for lc in c.to_lowercase() {
            if !keep_slug_char(lc) {
                continue;
            }
            match lc {
                'a'..='z' | '0'..='9' => {
                    if pending_hyphen && !out.is_empty() {
                        out.push('-');
                    }
                    pending_hyphen = false;
                    out.push(lc);
                }
                _ => {
                    if !out.is_empty() {
                        pending_hyphen = true;
                    }
                }
            }
        }
    }
    let base = if out.is_empty() {
        "vault".to_string()
    } else {
        out.chars().take(64).collect()
    };
    base.trim_matches('-').to_string()
}

/// Allocate a unique vault id from `display_name`, avoiding `existing_ids`.
///
/// Parity with TS `displayNameToVaultId` (collision `-2`, `-3`, …; skip invalid slugs).
pub fn display_name_to_vault_id(display_name: &str, existing_ids: &[String]) -> String {
    let base = display_name_to_slug_base(display_name);
    let mut candidate = base.clone();
    let mut suffix = 2u32;
    while existing_ids.iter().any(|id| id == &candidate) || !slug_id_is_valid(&candidate) {
        let tail = format!("-{suffix}");
        let keep = 64usize.saturating_sub(tail.len()).max(1);
        let mut stem: String = base.chars().take(keep).collect();
        while stem.ends_with('-') {
            stem.pop();
        }
        if stem.is_empty() {
            stem.push('v');
        }
        candidate = format!("{stem}{tail}");
        suffix = suffix.saturating_add(1);
        if suffix > 10_000 {
            // Extremely pathological — fall back to a unique-ish vault-N.
            candidate = format!("vault-{suffix}");
            break;
        }
    }
    candidate
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugifies_like_typescript() {
        assert_eq!(
            display_name_to_slug_base("My Encrypted Notes"),
            "my-encrypted-notes"
        );
        assert_eq!(display_name_to_slug_base("São Paulo"), "sao-paulo");
        assert_eq!(display_name_to_slug_base("!!!"), "vault");
        // ß is not NFD-decomposed in JS — becomes a hyphen.
        assert_eq!(display_name_to_slug_base("Straße"), "stra-e");
        // Letters that do not NFD-decompose must not get an extra Latin map.
        assert_eq!(display_name_to_slug_base("Øresund"), "resund");
        assert_eq!(display_name_to_slug_base("Kıbrıs"), "k-br-s");
        assert_eq!(display_name_to_slug_base("Łódź"), "odz");
        assert_eq!(display_name_to_slug_base("Đakovo"), "akovo");
        assert_eq!(display_name_to_slug_base("Ħamrun"), "amrun");
        // Precomposed letters the old Latin table missed (JS NFD keeps the base).
        assert_eq!(display_name_to_slug_base("Nguyễn"), "nguyen");
        assert_eq!(display_name_to_slug_base("Hà Nội"), "ha-noi");
        assert_eq!(display_name_to_slug_base("İstanbul"), "istanbul");
        // U+0149 does not canonically decompose; JS treats it as a hyphen.
        assert_eq!(display_name_to_slug_base("XŉY"), "x-y");
    }

    #[test]
    fn skips_windows_reserved_slug() {
        assert_eq!(display_name_to_vault_id("CON", &[]), "con-2");
    }

    #[test]
    fn deduplicates_with_suffix() {
        let existing = vec!["my-encrypted-notes".into()];
        assert_eq!(
            display_name_to_vault_id("My Encrypted Notes", &existing),
            "my-encrypted-notes-2"
        );
    }

    #[test]
    fn excludes_nothing_when_free() {
        assert_eq!(
            display_name_to_vault_id("My Encrypted Notes", &[]),
            "my-encrypted-notes"
        );
    }
}
