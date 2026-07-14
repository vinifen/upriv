use std::path::PathBuf;

fn main() {
    let manifest_dir =
        PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let version_path = manifest_dir.join("../../VERSION");
    let version = match std::fs::read_to_string(&version_path) {
        Ok(raw) => {
            let trimmed = raw.trim().to_string();
            if trimmed.is_empty() {
                eprintln!(
                    "cargo:warning={} is empty — using 0.0.0-dev",
                    version_path.display()
                );
                "0.0.0-dev".to_string()
            } else {
                trimmed
            }
        }
        Err(error) => {
            eprintln!(
                "cargo:warning=could not read {} ({error}) — using 0.0.0-dev",
                version_path.display()
            );
            "0.0.0-dev".to_string()
        }
    };

    println!("cargo:rerun-if-changed={}", version_path.display());
    println!("cargo:rustc-env=UPRIV_APP_VERSION={version}");
}
