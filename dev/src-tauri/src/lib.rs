/// Tauri shell — thin `#[tauri::command]` handlers delegate to `upriv-core`.
#[tauri::command]
fn app_version() -> String {
    upriv_core::app_version().to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_version])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
