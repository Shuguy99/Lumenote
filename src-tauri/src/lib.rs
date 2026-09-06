mod ai;
mod commands;
mod db;
mod export;
mod local_ai;
mod parser;
mod rag;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _conn = db::init_db().expect("failed to initialize database");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(local_ai::LocalAiManager::default())
        .invoke_handler(tauri::generate_handler![
            commands::load_documents,
            commands::add_document,
            commands::add_document_from_url,
            commands::reload_document,
            commands::import_folder,
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
            commands::test_provider_connection,
            commands::list_ollama_models,
            commands::export_notes_md,
            commands::export_chat_md,
            commands::export_chat_pdf,
            commands::export_notes_pdf,
            commands::local_ai_status,
            commands::download_local_ai,
            commands::start_local_ai_server,
            commands::stop_local_ai_server,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                local_ai::kill_local_server(app_handle);
            }
        });
}
