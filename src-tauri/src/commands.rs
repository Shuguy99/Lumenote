use crate::ai::{self, AiSettings};
use crate::db::{self, ChatMessage, Document, Note};
use crate::local_ai;
use crate::parser;
use crate::rag;

fn open_conn() -> Result<rusqlite::Connection, String> {
    let conn = rusqlite::Connection::open(db::db_path()).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA foreign_keys = ON;").map_err(|e| e.to_string())?;
    Ok(conn)
}

fn extract_settings(conn: &rusqlite::Connection) -> Result<AiSettings, String> {
    let provider = db::get_setting(conn, "ai_provider").map_err(|e| e.to_string())?
        .unwrap_or_else(|| "openai".into());
    let api_key = db::get_setting(conn, "ai_api_key").map_err(|e| e.to_string())?.unwrap_or_default();
    let model = db::get_setting(conn, "ai_model").map_err(|e| e.to_string())?
        .unwrap_or_else(|| default_model_for(&provider));
    let base_url = db::get_setting(conn, "ai_base_url").map_err(|e| e.to_string())?;
    let temperature = db::get_setting(conn, "ai_temperature").map_err(|e| e.to_string())?
        .unwrap_or_else(|| "0.7".into());
    let max_tokens = db::get_setting(conn, "ai_max_tokens").map_err(|e| e.to_string())?
        .unwrap_or_else(|| "2000".into());

    Ok(AiSettings {
        provider,
        api_key,
        model,
        base_url,
        temperature: temperature.parse().unwrap_or(0.7),
        max_tokens: max_tokens.parse().unwrap_or(2000),
    })
}

fn default_model_for(provider: &str) -> String {
    match provider {
        "anthropic" => "claude-3-5-sonnet-latest".into(),
        "ollama" => "llama3".into(),
        _ => "gpt-4o".into(),
    }
}

#[tauri::command]
pub fn load_documents() -> Result<Vec<Document>, String> {
    let conn = open_conn()?;
    db::get_documents(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_document(path: String) -> Result<Document, String> {
    let file_path = std::path::PathBuf::from(&path);
    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }

    let content = parser::parse_file(&file_path)?;
    let title = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("untitled")
        .to_string();
    let file_type = parser::get_file_type(&file_path);
    let size = parser::get_file_size(&file_path)?;

    let conn = open_conn()?;
    let id = db::insert_document(&conn, &title, &path, &content, &file_type, size)
        .map_err(|e| e.to_string())?;
    let doc = db::get_document(&conn, id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Document not found after insert".to_string())?;
    drop(conn);

    let settings = {
        let conn = open_conn()?;
        extract_settings(&conn)?
    };
    if !settings.api_key.is_empty() || settings.provider == "ollama" {
        let doc = doc.clone();
        tauri::async_runtime::spawn(async move {
            let _ = generate_summary_internal(&settings, &doc).await;
        });
    }

    Ok(doc)
}

#[tauri::command]
pub async fn add_document_from_url(url: String) -> Result<Document, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only http/https URLs are supported".to_string());
    }

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (compatible; Lumenote/0.1; +https://github.com/Shuguy99/Lumenote)")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client.get(parsed.clone()).send().await.map_err(|e| format!("Request failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Request failed with status: {}", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| format!("Failed to read response: {}", e))?;

    let content = parser::parse_html(&bytes)?;
    let title = parser::html_title(&bytes);
    let title = if title.is_empty() {
        parsed.host_str().unwrap_or("webpage").to_string()
    } else {
        title
    };

    let conn = open_conn()?;
    let id = db::insert_document(&conn, &title, &url, &content, "url", bytes.len() as i64)
        .map_err(|e| e.to_string())?;
    let doc = db::get_document(&conn, id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Document not found after insert".to_string())?;
    drop(conn);

    let settings = {
        let conn = open_conn()?;
        extract_settings(&conn)?
    };
    if !settings.api_key.is_empty() || settings.provider == "ollama" {
        let doc = doc.clone();
        tauri::async_runtime::spawn(async move {
            let _ = generate_summary_internal(&settings, &doc).await;
        });
    }

    Ok(doc)
}

async fn generate_summary_internal(settings: &AiSettings, doc: &Document) -> Result<(), String> {
    let text = &doc.content;
    let truncated: String = text.chars().take(12000).collect();
    let messages = vec![(
        "user".to_string(),
        format!(
            "Create a concise summary of the following document (3-5 bullet points maximum):\n\n{}",
            truncated
        ),
    )];

    let summary = ai::chat_completion(settings, &messages, &vec![]).await?;

    if let Ok(conn) = open_conn() {
        let _ = db::update_document_summary(&conn, doc.id, &summary);
    }
    Ok(())
}

#[tauri::command]
pub fn get_document(id: i64) -> Result<Option<Document>, String> {
    let conn = open_conn()?;
    db::get_document(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_document(id: i64) -> Result<(), String> {
    let conn = open_conn()?;
    db::delete_document(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_notes() -> Result<Vec<Note>, String> {
    let conn = open_conn()?;
    db::get_notes(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_note(id: i64) -> Result<Option<Note>, String> {
    let conn = open_conn()?;
    db::get_note(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_note(
    title: String,
    content: String,
    document_id: Option<i64>,
    anchor: Option<String>,
) -> Result<i64, String> {
    let conn = open_conn()?;
    db::insert_note(&conn, &title, &content, document_id, anchor).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn edit_note(
    id: i64,
    title: String,
    content: String,
    document_id: Option<i64>,
    anchor: Option<String>,
) -> Result<(), String> {
    let conn = open_conn()?;
    db::update_note(&conn, id, &title, &content, document_id, anchor).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_note(id: i64) -> Result<(), String> {
    let conn = open_conn()?;
    db::delete_note(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_chat_history(session_id: i64) -> Result<Vec<ChatMessage>, String> {
    let conn = open_conn()?;
    db::get_chat_messages(&conn, session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_chat_history(session_id: i64) -> Result<(), String> {
    let conn = open_conn()?;
    db::clear_chat(&conn, session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_chat_sessions() -> Result<Vec<db::ChatSession>, String> {
    let conn = open_conn()?;
    db::get_chat_sessions(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_chat_session(id: i64) -> Result<Option<db::ChatSession>, String> {
    let conn = open_conn()?;
    db::get_chat_session(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_chat_session(
    title: String,
    document_ids: Vec<i64>,
    note_id: Option<i64>,
) -> Result<i64, String> {
    let conn = open_conn()?;
    let ids_json = serde_json::to_string(&document_ids).map_err(|e| e.to_string())?;
    db::create_chat_session(&conn, &title, &ids_json, note_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_chat_session(
    id: i64,
    title: String,
    document_ids: Vec<i64>,
) -> Result<(), String> {
    let conn = open_conn()?;
    let ids_json = serde_json::to_string(&document_ids).map_err(|e| e.to_string())?;
    db::update_chat_session(&conn, id, &title, &ids_json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_chat_session(id: i64) -> Result<(), String> {
    let conn = open_conn()?;
    db::delete_chat_session(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_documents(query: String) -> Result<Vec<db::SearchResult>, String> {
    let conn = open_conn()?;
    db::search_documents(&conn, &query, 20).map_err(|e| e.to_string())
}

fn session_documents(conn: &rusqlite::Connection, session: &db::ChatSession) -> Vec<(String, String)> {
    let mut docs: Vec<(String, String)> = Vec::new();

    let ids: Vec<i64> = serde_json::from_str(&session.document_ids).unwrap_or_default();
    for id in &ids {
        if let Ok(Some(doc)) = db::get_document(conn, *id) {
            docs.push((doc.title, doc.content));
        }
    }

    if let Some(note_id) = session.note_id {
        if let Ok(Some(note)) = db::get_note(conn, note_id) {
            docs.push((format!("Заметка: {}", note.title), note.content));
        }
    }

    docs
}

#[tauri::command]
pub async fn send_chat_message(
    message: String,
    session_id: i64,
) -> Result<String, String> {
    let conn = open_conn()?;

    let session = db::get_chat_session(&conn, session_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Session not found".to_string())?;

    db::insert_chat_message(&conn, session_id, "user", &message).map_err(|e| e.to_string())?;

    let docs = session_documents(&conn, &session);

    let history = db::get_chat_messages(&conn, session_id).map_err(|e| e.to_string())?;
    drop(conn);

    let mut messages: Vec<(String, String)> = Vec::new();
    let start = history.len().saturating_sub(40);
    for msg in history.iter().skip(start) {
        messages.push((msg.role.clone(), msg.content.clone()));
    }

    let conn = open_conn()?;
    let settings = extract_settings(&conn)?;
    drop(conn);

    if settings.api_key.is_empty()
        && settings.provider != "ollama"
        && settings.provider != "local"
    {
        return Err("AI API key is not configured. Open Settings to configure it.".to_string());
    }

    let context = rag::build_context(&docs, &message, 3000);
    let response = ai::chat_completion_with_context(&settings, &messages, &docs, &context).await?;

    let conn = open_conn()?;
    db::insert_chat_message(&conn, session_id, "assistant", &response).map_err(|e| e.to_string())?;

    Ok(response)
}

#[tauri::command]
pub async fn stream_chat_message(
    message: String,
    session_id: i64,
    on_event: tauri::ipc::Channel<serde_json::Value>,
) -> Result<(), String> {
    let conn = open_conn()?;

    let session = db::get_chat_session(&conn, session_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Session not found".to_string())?;

    db::insert_chat_message(&conn, session_id, "user", &message).map_err(|e| e.to_string())?;

    let docs = session_documents(&conn, &session);

    let history = db::get_chat_messages(&conn, session_id).map_err(|e| e.to_string())?;
    drop(conn);

    let mut messages: Vec<(String, String)> = Vec::new();
    let start = history.len().saturating_sub(40);
    for msg in history.iter().skip(start) {
        messages.push((msg.role.clone(), msg.content.clone()));
    }

    let conn = open_conn()?;
    let settings = extract_settings(&conn)?;
    drop(conn);

    if settings.api_key.is_empty()
        && settings.provider != "ollama"
        && settings.provider != "local"
    {
        return Err("AI API key is not configured. Open Settings to configure it.".to_string());
    }

    if settings.provider == "local" && !local_ai::is_server_ready().await {
        return Err(
            "Встроенная модель не запущена. Откройте «Настройки AI» и нажмите «Запустить встроенную модель»."
                .to_string(),
        );
    }

    let context = rag::build_context(&docs, &message, 3000);
    let result = ai::stream_chat_completion(&settings, &messages, &docs, &context, on_event).await?;

    if !result.is_empty() {
        let conn2 = open_conn()?;
        db::insert_chat_message(&conn2, session_id, "assistant", &result)
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn get_settings() -> Result<serde_json::Value, String> {
    let conn = open_conn()?;
    let settings = AiSettings {
        provider: db::get_setting(&conn, "ai_provider").map_err(|e| e.to_string())?
            .unwrap_or_else(|| "openai".into()),
        api_key: db::get_setting(&conn, "ai_api_key").map_err(|e| e.to_string())?.unwrap_or_default(),
        model: db::get_setting(&conn, "ai_model").map_err(|e| e.to_string())?
            .unwrap_or_else(|| "gpt-4o".into()),
        base_url: db::get_setting(&conn, "ai_base_url").map_err(|e| e.to_string())?,
        temperature: db::get_setting(&conn, "ai_temperature").map_err(|e| e.to_string())?
            .unwrap_or_else(|| "0.7".into())
            .parse()
            .unwrap_or(0.7),
        max_tokens: db::get_setting(&conn, "ai_max_tokens").map_err(|e| e.to_string())?
            .unwrap_or_else(|| "2000".into())
            .parse()
            .unwrap_or(2000),
    };
    drop(conn);

    let masked = |k: &str| {
        if k.is_empty() {
            String::new()
        } else if k.len() > 8 {
            format!("{}...{}", &k[..4], &k[k.len() - 4..])
        } else {
            "****".to_string()
        }
    };

    Ok(serde_json::json!({
        "provider": settings.provider,
        "api_key_masked": masked(&settings.api_key),
        "has_api_key": !settings.api_key.is_empty(),
        "api_key": "",
        "model": settings.model,
        "base_url": settings.base_url,
        "temperature": settings.temperature,
        "max_tokens": settings.max_tokens,
    }))
}

#[tauri::command]
pub fn save_settings(
    provider: String,
    api_key: String,
    model: String,
    base_url: Option<String>,
    temperature: f32,
    max_tokens: u32,
) -> Result<(), String> {
    let conn = open_conn()?;
    db::set_setting(&conn, "ai_provider", &provider).map_err(|e| e.to_string())?;
    let existing_key = db::get_setting(&conn, "ai_api_key")
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    if !api_key.is_empty() || existing_key.is_empty() {
        db::set_setting(&conn, "ai_api_key", &api_key).map_err(|e| e.to_string())?;
    }
    db::set_setting(&conn, "ai_model", &model).map_err(|e| e.to_string())?;
    if let Some(bu) = &base_url {
        db::set_setting(&conn, "ai_base_url", bu).map_err(|e| e.to_string())?;
    }
    db::set_setting(&conn, "ai_temperature", &temperature.to_string()).map_err(|e| e.to_string())?;
    db::set_setting(&conn, "ai_max_tokens", &max_tokens.to_string()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn test_provider_connection(
    provider: String,
    api_key: String,
    base_url: Option<String>,
) -> Result<String, String> {
    let effective_key = if api_key.trim().is_empty() {
        let conn = open_conn()?;
        db::get_setting(&conn, "ai_api_key")
            .map_err(|e| e.to_string())?
            .unwrap_or_default()
    } else {
        api_key.trim().to_string()
    };
    ai::test_provider_connection(&provider, &effective_key, base_url).await
}

#[tauri::command]
pub async fn list_ollama_models(base_url: Option<String>) -> Result<Vec<String>, String> {
    ai::list_ollama_models(base_url).await
}

fn export_md_file(path: &str, content: &str) -> Result<(), String> {
    std::fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_notes_md(note_ids: Vec<i64>, path: String) -> Result<(), String> {
    let conn = open_conn()?;
    let mut out = String::new();
    for id in &note_ids {
        if let Ok(Some(note)) = db::get_note(&conn, *id) {
            let title = if note.title.trim().is_empty() {
                "Без названия".to_string()
            } else {
                note.title.clone()
            };
            out.push_str(&format!("# {title}\n\n"));
            out.push_str(&note.content.trim());
            out.push_str("\n\n---\n\n");
        }
    }
    drop(conn);
    export_md_file(&path, &out)
}

#[tauri::command]
pub fn export_chat_md(session_id: i64, path: String) -> Result<(), String> {
    let conn = open_conn()?;
    let title = db::get_chat_session(&conn, session_id)
        .map_err(|e| e.to_string())?
        .map(|s| s.title)
        .ok_or_else(|| "Session not found".to_string())?;
    let messages = db::get_chat_messages(&conn, session_id).map_err(|e| e.to_string())?;
    drop(conn);

    let mut out = format!("# Чат: {title}\n\n");
    for msg in &messages {
        let who = if msg.role == "user" {
            "**Вы:**"
        } else {
            "**AI:**"
        };
        out.push_str(who);
        out.push('\n');
        out.push_str(&msg.content.trim());
        out.push_str("\n\n---\n\n");
    }
    export_md_file(&path, &out)
}

#[tauri::command]
pub fn export_chat_pdf(session_id: i64, path: String) -> Result<(), String> {
    let conn = open_conn()?;
    let title = db::get_chat_session(&conn, session_id)
        .map_err(|e| e.to_string())?
        .map(|s| s.title)
        .ok_or_else(|| "Session not found".to_string())?;
    let messages = db::get_chat_messages(&conn, session_id).map_err(|e| e.to_string())?;
    drop(conn);

    let mut out = format!("# Чат: {title}\n\n");
    for msg in &messages {
        let who = if msg.role == "user" { "Вопрос:" } else { "Ответ:" };
        out.push_str(&format!("**{who}**\n\n"));
        out.push_str(&msg.content.trim());
        out.push_str("\n\n");
    }
    crate::export::export_pdf(&out, &path)
}

#[tauri::command]
pub fn export_notes_pdf(note_ids: Vec<i64>, path: String) -> Result<(), String> {
    let conn = open_conn()?;
    let mut out = String::new();
    for id in &note_ids {
        if let Ok(Some(note)) = db::get_note(&conn, *id) {
            let title = if note.title.trim().is_empty() {
                "Без названия".to_string()
            } else {
                note.title.clone()
            };
            out.push_str(&format!("# {title}\n\n"));
            out.push_str(&note.content.trim());
            out.push_str("\n\n");
        }
    }
    drop(conn);
    crate::export::export_pdf(&out, &path)
}

#[tauri::command]
pub async fn local_ai_status(app: tauri::AppHandle) -> local_ai::LocalAiStatus {
    local_ai::get_local_ai_status(app).await
}

#[tauri::command]
pub fn download_local_ai(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(local_ai::download_local_ai(app));
}

#[tauri::command]
pub async fn start_local_ai_server(app: tauri::AppHandle) -> Result<(), String> {
    local_ai::start_local_server(app).await
}

#[tauri::command]
pub async fn stop_local_ai_server(app: tauri::AppHandle) -> Result<(), String> {
    local_ai::stop_local_server(app).await
}
