use std::path::PathBuf;

fn main() {
    let manifest_dir =
        PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let version_path = manifest_dir.join("../../VERSION");
    let version = std::fs::read_to_string(&version_path)
        .unwrap_or_else(|error| panic!("read {}: {error}", version_path.display()))
        .trim()
        .to_string();

    if version.is_empty() {
        panic!("{} is empty — expected a version string", version_path.display());
    }

    println!("cargo:rerun-if-changed={}", version_path.display());
    println!("cargo:rustc-env=UPRIV_APP_VERSION={version}");
}
