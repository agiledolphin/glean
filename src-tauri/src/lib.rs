pub mod commands;
pub mod db;
pub mod dict;
pub mod export;
pub mod tts;

use tauri::Emitter;
use commands::dict_commands::*;
use commands::vocab_commands::*;
use commands::stats_commands::*;
use export::export_vocabulary;
use tts::{play_pronunciation, play_mdd_audio};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    pretty_env_logger::init();

    // Initialize database and dict registry
    db::init().expect("Failed to initialize database");
    dict::init_registry();

    tauri::Builder::default()
        .register_uri_scheme_protocol("mdd", |_app, request| {
            use tauri::http;
            let not_found = || http::Response::builder()
                .status(404).body(Vec::new()).unwrap();

            let uri = request.uri();
            let dict_id = uri.host().unwrap_or("");
            // path is "/filename.ext" — strip leading slash, add backslash for MDD key
            let raw = uri.path().trim_start_matches('/');
            if raw.is_empty() { return not_found(); }
            // MDD keys use backslash separators; URLs use forward slashes
            let filename = raw.replace('/', "\\");
            let mdd_key = format!("\\{filename}");

            let registry = match dict::DICT_REGISTRY.get() {
                Some(r) => r.read().unwrap(),
                None => return not_found(),
            };
            let dict = match registry.get(dict_id) {
                Some(d) => d,
                None => return not_found(),
            };
            let mdd = match dict.mdd.as_ref() {
                Some(m) => m,
                None => return not_found(),
            };
            match mdd.lookup(&mdd_key) {
                Ok(Some(data)) => {
                    let mime = match raw.rsplit('.').next().unwrap_or("") {
                        "svg"  => "image/svg+xml",
                        "png"  => "image/png",
                        "jpg" | "jpeg" => "image/jpeg",
                        "gif"  => "image/gif",
                        "webp" => "image/webp",
                        "css"  => "text/css",
                        "js"   => "application/javascript",
                        _      => "application/octet-stream",
                    };
                    http::Response::builder()
                        .status(200)
                        .header("Content-Type", mime)
                        .header("Access-Control-Allow-Origin", "*")
                        .body(data).unwrap()
                }
                _ => not_found(),
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                commands::dict_commands::preload_dicts();
                handle.emit("dicts-ready", ()).ok();
            });
            Ok(())
        })
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            // Dict
            are_dicts_ready,
            import_dictionary,
            list_dictionaries,
            update_dictionary_order,
            toggle_dictionary,
            remove_dictionary,
            search_candidates,
            lookup_word,
            get_recent_history,
            // Vocabulary
            count_vocabulary,
            add_to_vocabulary,
            remove_from_vocabulary,
            is_in_vocabulary,
            list_vocabulary,
            update_vocabulary_note,
            toggle_star,
            get_vocabulary_tags,
            // Tags
            list_tags,
            create_tag,
            rename_tag,
            delete_tag,
            set_default_tag,
            add_tag_to_word,
            remove_tag_from_word,
            // Stats
            get_word_stats,
            get_query_trend,
            // Audio
            play_pronunciation,
            play_mdd_audio,
            // Import
            preview_import_file,
            import_vocabulary_from_file,
            // Export
            export_vocabulary,
            // Debug
            get_dict_icons,
            debug_mdx_header,
            debug_mdd_keys,
            debug_audio,
            debug_dict_css,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
