// The desktop shell. Today it hosts the web UI and gives it a CORS-free HTTP
// client for Murmur's optional AI providers. The Rust audio engine and VST/CLAP
// hosting will live here later (see README, "VST support").

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running Wellsprings");
}
