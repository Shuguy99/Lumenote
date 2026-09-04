use rusqlite::{Connection, params};
use serde::Serialize;
use std::path::PathBuf;

#[derive(Clone, Serialize)]
pub struct Document {
    pub id: i64,
    pub title: String,
    pub file_path: String,
    pub content: String,
    pub content_preview: String,
    pub file_type: String,
    pub size: i64,
    pub summary: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Serialize)]
pub struct Note {
    pub id: i64,
    pub title: String,
    pub content: String,
    pub document_id: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Serialize)]
pub struct ChatMessage {
    pub id: i64,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

pub fn app_data_dir() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("ai-notebook")
}

pub fn db_path() -> PathBuf {
    let dir = app_data_dir();
    std::fs::create_dir_all(&dir).ok();
    dir.join("ai_notebook.db")
}

pub fn init_db() -> rusqlite::Result<Connection> {
    let conn = Connection::open(db_path())?;
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        
        CREATE TABLE IF NOT EXISTS documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            file_path TEXT NOT NULL,
            content TEXT NOT NULL,
            content_preview TEXT NOT NULL,
            file_type TEXT NOT NULL,
            size INTEGER NOT NULL,
            summary TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        ",
    )?;
    Ok(conn)
}

pub fn insert_document(
    conn: &Connection,
    title: &str,
    file_path: &str,
    content: &str,
    file_type: &str,
    size: i64,
) -> rusqlite::Result<i64> {
    let preview: String = content.chars().take(300).collect();
    conn.execute(
        "INSERT INTO documents (title, file_path, content, content_preview, file_type, size)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![title, file_path, content, preview, file_type, size],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get_documents(conn: &Connection) -> rusqlite::Result<Vec<Document>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, file_path, content, content_preview, file_type, size, summary, created_at
         FROM documents ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Document {
            id: row.get(0)?,
            title: row.get(1)?,
            file_path: row.get(2)?,
            content: row.get(3)?,
            content_preview: row.get(4)?,
            file_type: row.get(5)?,
            size: row.get(6)?,
            summary: row.get(7)?,
            created_at: row.get(8)?,
        })
    })?;

    let mut docs = Vec::new();
    for r in rows {
        docs.push(r?);
    }
    Ok(docs)
}

pub fn get_document(conn: &Connection, id: i64) -> rusqlite::Result<Option<Document>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, file_path, content, content_preview, file_type, size, summary, created_at
         FROM documents WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![id], |row| {
        Ok(Document {
            id: row.get(0)?,
            title: row.get(1)?,
            file_path: row.get(2)?,
            content: row.get(3)?,
            content_preview: row.get(4)?,
            file_type: row.get(5)?,
            size: row.get(6)?,
            summary: row.get(7)?,
            created_at: row.get(8)?,
        })
    })?;
    rows.next().transpose()
}

pub fn update_document_summary(conn: &Connection, id: i64, summary: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE documents SET summary = ?1 WHERE id = ?2",
        params![summary, id],
    )?;
    Ok(())
}

pub fn delete_document(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM documents WHERE id = ?1", params![id])?;
    Ok(())
}

#[derive(Clone, Serialize)]
pub struct SearchResult {
    pub document_id: i64,
    pub title: String,
    pub snippet: String,
    pub match_index: i64,
}

pub fn search_documents(
    conn: &Connection,
    query: &str,
    limit: usize,
) -> rusqlite::Result<Vec<SearchResult>> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let mut stmt = conn.prepare(
        "SELECT id, title, content FROM documents ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;

    let mut results: Vec<SearchResult> = Vec::new();
    for r in rows {
        let (id, title, content) = r?;
        let content_lower = content.to_lowercase();
        let mut search_from = 0usize;
        let mut found_in_doc = 0usize;

        while let Some(rel) = content_lower[search_from..].find(&q) {
            let abs_pos = search_from + rel;
            let start = abs_pos.saturating_sub(120);
            let end = (abs_pos + q.len() + 120).min(content.len());

            let safe_start = prev_char_boundary(&content, start);
            let safe_end = next_char_boundary(&content, end);
            let snippet: String = content[safe_start..safe_end]
                .chars()
                .take(400)
                .collect::<String>()
                .lines()
                .filter(|l| !l.trim().is_empty())
                .take(3)
                .collect::<Vec<_>>()
                .join(" ");

            results.push(SearchResult {
                document_id: id,
                title: title.clone(),
                snippet,
                match_index: found_in_doc as i64,
            });

            found_in_doc += 1;
            search_from = abs_pos + 1;
            if found_in_doc >= 5 || results.len() >= limit {
                break;
            }
        }
        if results.len() >= limit {
            break;
        }
    }
    Ok(results)
}

fn prev_char_boundary(s: &str, mut idx: usize) -> usize {
    while idx > 0 && !s.is_char_boundary(idx) {
        idx -= 1;
    }
    idx
}

fn next_char_boundary(s: &str, mut idx: usize) -> usize {
    while idx < s.len() && !s.is_char_boundary(idx) {
        idx += 1;
    }
    idx
}

pub fn insert_note(
    conn: &Connection,
    title: &str,
    content: &str,
    document_id: Option<i64>,
) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO notes (title, content, document_id) VALUES (?1, ?2, ?3)",
        params![title, content, document_id],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn update_note(
    conn: &Connection,
    id: i64,
    title: &str,
    content: &str,
    document_id: Option<i64>,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE notes SET title = ?1, content = ?2, document_id = ?3, updated_at = datetime('now')
         WHERE id = ?4",
        params![title, content, document_id, id],
    )?;
    Ok(())
}

pub fn get_notes(conn: &Connection) -> rusqlite::Result<Vec<Note>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, content, document_id, created_at, updated_at
         FROM notes ORDER BY updated_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Note {
            id: row.get(0)?,
            title: row.get(1)?,
            content: row.get(2)?,
            document_id: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        })
    })?;

    let mut notes = Vec::new();
    for r in rows {
        notes.push(r?);
    }
    Ok(notes)
}

pub fn get_note(conn: &Connection, id: i64) -> rusqlite::Result<Option<Note>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, content, document_id, created_at, updated_at
         FROM notes WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![id], |row| {
        Ok(Note {
            id: row.get(0)?,
            title: row.get(1)?,
            content: row.get(2)?,
            document_id: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        })
    })?;
    rows.next().transpose()
}

pub fn delete_note(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM notes WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn insert_chat_message(conn: &Connection, role: &str, content: &str) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO chat_messages (role, content) VALUES (?1, ?2)",
        params![role, content],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get_chat_messages(conn: &Connection) -> rusqlite::Result<Vec<ChatMessage>> {
    let mut stmt = conn.prepare(
        "SELECT id, role, content, created_at FROM chat_messages ORDER BY id",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(ChatMessage {
            id: row.get(0)?,
            role: row.get(1)?,
            content: row.get(2)?,
            created_at: row.get(3)?,
        })
    })?;

    let mut msgs = Vec::new();
    for r in rows {
        msgs.push(r?);
    }
    Ok(msgs)
}

pub fn clear_chat(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM chat_messages", [])?;
    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
    let mut rows = stmt.query_map(params![key], |row| row.get::<_, String>(0))?;
    rows.next().transpose()
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = ?2",
        params![key, value],
    )?;
    Ok(())
}
