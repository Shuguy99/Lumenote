mod ai;
mod commands;
mod db;
mod parser;
mod rag;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _conn = db::init_db().expect("failed to initialize database");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            commands::load_documents,
            commands::add_document,
            commands::get_document,
            commands::delete_document,
            commands::list_notes,
            commands::get_note,
            commands::create_note,
            commands::edit_note,
            commands::delete_note,
            commands::get_chat_history,
            commands::clear_chat_history,
            commands::send_chat_message,
            commands::stream_chat_message,
            commands::search_documents,
            commands::get_settings,
            commands::save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
