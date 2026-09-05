mod ai;
mod commands;
mod db;
mod export;
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
            commands::add_document_from_url,
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
            commands::list_chat_sessions,
            commands::get_chat_session,
            commands::create_chat_session,
            commands::update_chat_session,
            commands::delete_chat_session,
            commands::search_documents,
            commands::get_settings,
            commands::save_settings,
            commands::export_notes_md,
            commands::export_chat_md,
            commands::export_chat_pdf,
            commands::export_notes_pdf,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
