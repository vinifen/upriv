//! How many files an import may read and encrypt at once.
//!
//! One of those files is the one being written into the vault. The others
//! read and encrypt the next files. The index is updated one file at a time.
//! A single core stays on one file. The cap leaves cores for the interface,
//! unlock, and close.

/// `phone` uses the smaller cap (Android and iOS). Desktop uses the larger one.
pub fn import_slots_for(cores: usize, phone: bool) -> usize {
    let cores = cores.max(1);
    if phone {
        cores.saturating_sub(1).clamp(1, 2)
    } else {
        cores.saturating_sub(2).clamp(1, 4)
    }
}

pub fn import_slots() -> usize {
    let cores = std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(1);
    import_slots_for(cores, cfg!(any(target_os = "android", target_os = "ios")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_core_imports_one_file() {
        assert_eq!(import_slots_for(0, false), 1);
        assert_eq!(import_slots_for(1, false), 1);
        assert_eq!(import_slots_for(1, true), 1);
        assert_eq!(import_slots_for(2, true), 1);
    }

    #[test]
    fn spare_cores_are_capped() {
        assert_eq!(import_slots_for(4, false), 2);
        assert_eq!(import_slots_for(8, false), 4);
        assert_eq!(import_slots_for(16, false), 4);
        assert_eq!(import_slots_for(4, true), 2);
        assert_eq!(import_slots_for(8, true), 2);
    }
}
