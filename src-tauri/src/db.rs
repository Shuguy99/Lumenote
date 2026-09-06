use rusqlite::{Connection, OptionalExtension, params};
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
    pub anchor: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Serialize)]
pub struct ChatMessage {
    pub id: i64,
    pub session_id: i64,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Clone, Serialize)]
pub struct ChatSession {
    pub id: i64,
    pub title: String,
    pub document_ids: String,
    pub note_id: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

pub fn app_data_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("LUMENOTE_DATA_DIR") {
        let dir = dir.trim();
        if !dir.is_empty() {
            return PathBuf::from(dir);
        }
    }
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
        PRAGMA foreign_keys = ON;
        ",
    )?;

    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;

    if version < 1 {
        conn.execute_batch(
            "
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
                anchor TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS chat_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL DEFAULT 'Новый чат',
                document_ids TEXT NOT NULL DEFAULT '[]',
                note_id INTEGER REFERENCES notes(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL DEFAULT 1,
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
    }

    // Defensive backfill: schemas created by earlier ad-hoc migrations may be
    // missing these columns even though user_version was never bumped.
    if !column_exists(&conn, "notes", "anchor")? {
        conn.execute_batch("ALTER TABLE notes ADD COLUMN anchor TEXT;")?;
    }
    if !column_exists(&conn, "chat_messages", "session_id")? {
        conn.execute_batch(
            "ALTER TABLE chat_messages ADD COLUMN session_id INTEGER NOT NULL DEFAULT 1;",
        )?;
    }

    // v4: full-text search index over documents + RAG chunk cache.
    if version < 4 {
        conn.execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts
             USING fts5(title, content, tokenize='unicode61');

             CREATE TABLE IF NOT EXISTS document_chunks (
                 document_id INTEGER PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
                 chunks TEXT NOT NULL
             );",
        )?;
        let indexed: i64 = conn.query_row("SELECT COUNT(*) FROM documents_fts", [], |r| r.get(0))?;
        if indexed == 0 {
            conn.execute_batch(
                "INSERT INTO documents_fts(rowid, title, content)
                 SELECT id, title, content FROM documents;",
            )?;
        }
    }

    let session_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM chat_sessions",
        [],
        |r| r.get(0),
    )?;
    if session_count == 0 {
        conn.execute(
            "INSERT INTO chat_sessions (title, document_ids) VALUES (?1, ?2)",
            params!["Основной чат", "[]"],
        )?;
        let default_session: i64 = conn.last_insert_rowid();
        conn.execute(
            "UPDATE chat_messages SET session_id = ?1 WHERE session_id < 1",
            params![default_session],
        )?;
    }

    conn.execute_batch("PRAGMA user_version = 4;")?;

    Ok(conn)
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> rusqlite::Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
    let mut rows = stmt.query_map([], |r| r.get::<_, String>(1))?;
    let mut found = false;
    while let Some(name) = rows.next() {
        if name? == column {
            found = true;
            break;
        }
    }
    Ok(found)
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
    let id = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO documents_fts(rowid, title, content) VALUES (?1, ?2, ?3)",
        params![id, title, content],
    )?;
    Ok(id)
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

pub fn find_document_by_content(
    conn: &Connection,
    content: &str,
) -> rusqlite::Result<Option<Document>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, file_path, content, content_preview, file_type, size, summary, created_at
         FROM documents WHERE content = ?1 LIMIT 1",
    )?;
    let mut rows = stmt.query_map(params![content], |row| {
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

pub fn get_document_chunks(conn: &Connection, document_id: i64) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT chunks FROM document_chunks WHERE document_id = ?1",
        params![document_id],
        |row| row.get::<_, String>(0),
    )
    .optional()
}

pub fn set_document_chunks(
    conn: &Connection,
    document_id: i64,
    chunks: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO document_chunks (document_id, chunks) VALUES (?1, ?2)
         ON CONFLICT(document_id) DO UPDATE SET chunks = ?2",
        params![document_id, chunks],
    )?;
    Ok(())
}

pub fn delete_document(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM documents_fts WHERE rowid = ?1", params![id])?;
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
    let fts_query = build_fts_query(query);
    if fts_query.is_empty() {
        return Ok(Vec::new());
    }

    let sql = "SELECT rowid, title, snippet(documents_fts, 1, '', '', '…', 18)
               FROM documents_fts WHERE documents_fts MATCH ?1
               ORDER BY rank LIMIT ?2";
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params![fts_query, limit as i64], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
        ))
    })?;

    let mut results = Vec::new();
    for r in rows {
        let (id, title, snippet) = r?;
        results.push(SearchResult {
            document_id: id,
            title,
            snippet: snippet.unwrap_or_default(),
            match_index: 0,
        });
    }
    Ok(results)
}

fn build_fts_query(raw: &str) -> String {
    raw.split(|c: char| !c.is_alphanumeric() && c != '_')
        .filter(|w| !w.is_empty())
        .map(|w| format!("{}*", w))
        .collect::<Vec<_>>()
        .join(" AND ")
}

pub fn insert_note(
    conn: &Connection,
    title: &str,
    content: &str,
    document_id: Option<i64>,
    anchor: Option<String>,
) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO notes (title, content, document_id, anchor) VALUES (?1, ?2, ?3, ?4)",
        params![title, content, document_id, anchor],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn update_note(
    conn: &Connection,
    id: i64,
    title: &str,
    content: &str,
    document_id: Option<i64>,
    anchor: Option<String>,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE notes SET title = ?1, content = ?2, document_id = ?3, anchor = ?4, updated_at = datetime('now')
         WHERE id = ?5",
        params![title, content, document_id, anchor, id],
    )?;
    Ok(())
}

pub fn get_notes(conn: &Connection) -> rusqlite::Result<Vec<Note>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, content, document_id, anchor, created_at, updated_at
         FROM notes ORDER BY updated_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Note {
            id: row.get(0)?,
            title: row.get(1)?,
            content: row.get(2)?,
            document_id: row.get(3)?,
            anchor: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
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
        "SELECT id, title, content, document_id, anchor, created_at, updated_at
         FROM notes WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![id], |row| {
        Ok(Note {
            id: row.get(0)?,
            title: row.get(1)?,
            content: row.get(2)?,
            document_id: row.get(3)?,
            anchor: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        })
    })?;
    rows.next().transpose()
}

pub fn delete_note(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM notes WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn insert_chat_message(conn: &Connection, session_id: i64, role: &str, content: &str) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO chat_messages (session_id, role, content) VALUES (?1, ?2, ?3)",
        params![session_id, role, content],
    )?;
    conn.execute(
        "UPDATE chat_sessions SET updated_at = datetime('now') WHERE id = ?1",
        params![session_id],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get_chat_messages(conn: &Connection, session_id: i64) -> rusqlite::Result<Vec<ChatMessage>> {
    let mut stmt = conn.prepare(
        "SELECT id, session_id, role, content, created_at FROM chat_messages
         WHERE session_id = ?1 ORDER BY id",
    )?;
    let rows = stmt.query_map(params![session_id], |row| {
        Ok(ChatMessage {
            id: row.get(0)?,
            session_id: row.get(1)?,
            role: row.get(2)?,
            content: row.get(3)?,
            created_at: row.get(4)?,
        })
    })?;

    let mut msgs = Vec::new();
    for r in rows {
        msgs.push(r?);
    }
    Ok(msgs)
}

pub fn clear_chat(conn: &Connection, session_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM chat_messages WHERE session_id = ?1",
        params![session_id],
    )?;
    Ok(())
}

pub fn create_chat_session(
    conn: &Connection,
    title: &str,
    document_ids: &str,
    note_id: Option<i64>,
) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO chat_sessions (title, document_ids, note_id) VALUES (?1, ?2, ?3)",
        params![title, document_ids, note_id],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get_chat_sessions(conn: &Connection) -> rusqlite::Result<Vec<ChatSession>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, document_ids, note_id, created_at, updated_at
         FROM chat_sessions ORDER BY updated_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(ChatSession {
            id: row.get(0)?,
            title: row.get(1)?,
            document_ids: row.get(2)?,
            note_id: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        })
    })?;

    let mut sessions = Vec::new();
    for r in rows {
        sessions.push(r?);
    }
    Ok(sessions)
}

pub fn get_chat_session(conn: &Connection, id: i64) -> rusqlite::Result<Option<ChatSession>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, document_ids, note_id, created_at, updated_at
         FROM chat_sessions WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![id], |row| {
        Ok(ChatSession {
            id: row.get(0)?,
            title: row.get(1)?,
            document_ids: row.get(2)?,
            note_id: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        })
    })?;
    rows.next().transpose()
}

pub fn update_chat_session(
    conn: &Connection,
    id: i64,
    title: &str,
    document_ids: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE chat_sessions SET title = ?1, document_ids = ?2, updated_at = datetime('now')
         WHERE id = ?3",
        params![title, document_ids, id],
    )?;
    Ok(())
}

pub fn delete_chat_session(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM chat_messages WHERE session_id = ?1", params![id])?;
    conn.execute("DELETE FROM chat_sessions WHERE id = ?1", params![id])?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // init_db writes to LUMENOTE_DATA_DIR, which is process-global.
    // Serialize these tests to avoid races on the env var.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn with_temp_dir(f: impl FnOnce(&std::path::Path)) {
        let _guard = ENV_LOCK.lock().unwrap();
        let dir = std::env::temp_dir().join(format!(
            "lumenote_db_test_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::env::set_var("LUMENOTE_DATA_DIR", &dir);
        f(&dir);
        std::env::remove_var("LUMENOTE_DATA_DIR");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn fresh_init_creates_schema_and_default_session() {
        with_temp_dir(|_| {
            let conn = init_db().unwrap();
            let version: i64 = conn
                .query_row("PRAGMA user_version", [], |r| r.get(0))
                .unwrap();
            assert_eq!(version, 4);
            assert!(column_exists(&conn, "notes", "anchor").unwrap());
            assert!(column_exists(&conn, "chat_messages", "session_id").unwrap());
            let sessions: i64 = conn
                .query_row("SELECT COUNT(*) FROM chat_sessions", [], |r| r.get(0))
                .unwrap();
            assert_eq!(sessions, 1);
        });
    }

    #[test]
    fn legacy_schema_migrates_without_data_loss() {
        with_temp_dir(|_| {
            let legacy_path = db_path();
            {
                let conn = Connection::open(&legacy_path).unwrap();
                conn.execute_batch(
                    "
                    CREATE TABLE documents (
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
                    CREATE TABLE notes (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        title TEXT NOT NULL,
                        content TEXT NOT NULL DEFAULT '',
                        document_id INTEGER,
                        created_at TEXT NOT NULL DEFAULT (datetime('now')),
                        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                    CREATE TABLE chat_sessions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        title TEXT NOT NULL DEFAULT 'Новый чат',
                        document_ids TEXT NOT NULL DEFAULT '[]',
                        note_id INTEGER,
                        created_at TEXT NOT NULL DEFAULT (datetime('now')),
                        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                    CREATE TABLE chat_messages (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        role TEXT NOT NULL,
                        content TEXT NOT NULL,
                        created_at TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                    CREATE TABLE settings (
                        key TEXT PRIMARY KEY,
                        value TEXT NOT NULL
                    );
                    ",
                )
                .unwrap();
                conn.execute(
                    "INSERT INTO documents (title, file_path, content, content_preview, file_type, size)
                     VALUES ('legacy doc', '/tmp/d', 'body', 'body', 'txt', 4)",
                    params![],
                )
                .unwrap();
                let doc_id = conn.last_insert_rowid();
                conn.execute(
                    "INSERT INTO notes (title, content, document_id) VALUES ('keep', 'data', ?1)",
                    params![doc_id],
                )
                .unwrap();
                conn.execute(
                    "INSERT INTO chat_messages (role, content) VALUES ('user', 'hello')",
                    params![],
                )
                .unwrap();
                conn.execute_batch("PRAGMA user_version = 0;").unwrap();
            }

            let conn = init_db().unwrap();

            // Existing data untouched.
            let title: String = conn
                .query_row("SELECT title FROM notes WHERE id = 1", [], |r| r.get(0))
                .unwrap();
            assert_eq!(title, "keep");
            let summaries: i64 = conn
                .query_row("SELECT COUNT(*) FROM documents", [], |r| r.get(0))
                .unwrap();
            assert_eq!(summaries, 1);

            // Columns backfilled.
            assert!(column_exists(&conn, "notes", "anchor").unwrap());
            assert!(column_exists(&conn, "chat_messages", "session_id").unwrap());

            // Full-text index built over legacy documents.
            let results = search_documents(&conn, "body", 10).unwrap();
            assert_eq!(results.len(), 1);
            assert_eq!(results[0].document_id, 1);

            // One default session exists and the orphaned message was attached to it.
            let sessions: i64 = conn
                .query_row("SELECT COUNT(*) FROM chat_sessions", [], |r| r.get(0))
                .unwrap();
            assert_eq!(sessions, 1);
            let orphan: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM chat_messages m JOIN chat_sessions s ON s.id = m.session_id",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(orphan, 1);
        });
    }

    #[test]
    fn fts_search_indexes_and_deletes_documents() {
        with_temp_dir(|_| {
            let conn = init_db().unwrap();
            insert_document(
                &conn,
                "Отчёт",
                "/tmp/1.txt",
                "Квантовая физика и нейросети. Очень длинный вводный текст.",
                "txt",
                1,
            )
            .unwrap();
            insert_document(
                &conn,
                "Инструкция",
                "/tmp/2.txt",
                "Как починить принтер шаг за шагом.",
                "txt",
                1,
            )
            .unwrap();

            let results = search_documents(&conn, "квант", 10).unwrap();
            assert_eq!(results.len(), 1);
            assert_eq!(results[0].document_id, 1);
            assert_eq!(results[0].title, "Отчёт");
            assert!(!results[0].snippet.is_empty());

            let multi = search_documents(&conn, "физика нейросети", 10).unwrap();
            assert_eq!(multi.len(), 1);

            delete_document(&conn, 1).unwrap();
            let after_delete = search_documents(&conn, "квант", 10).unwrap();
            assert!(after_delete.is_empty());
        });
    }

    #[test]
    fn document_chunks_cache_roundtrip_and_cascade() {
        with_temp_dir(|_| {
            let conn = init_db().unwrap();
            let doc_id = insert_document(&conn, "Док", "/tmp/1.txt", "контент", "txt", 1).unwrap();
            assert!(get_document_chunks(&conn, doc_id).unwrap().is_none());

            set_document_chunks(&conn, doc_id, "[\"часть 1\",\"часть 2\"]").unwrap();
            assert_eq!(
                get_document_chunks(&conn, doc_id).unwrap().unwrap(),
                "[\"часть 1\",\"часть 2\"]"
            );

            delete_document(&conn, doc_id).unwrap();
            assert!(get_document_chunks(&conn, doc_id).unwrap().is_none());
        });
    }

    #[test]
    fn foreign_keys_enforce_set_null_on_document_delete() {
        with_temp_dir(|_| {
            let conn = init_db().unwrap();
            conn.execute(
                "INSERT INTO documents (title, file_path, content, content_preview, file_type, size)
                 VALUES ('doc', '/tmp/d', 'c', 'c', 'txt', 1)",
                params![],
            )
            .unwrap();
            let doc_id = conn.last_insert_rowid();
            conn.execute(
                "INSERT INTO notes (title, content, document_id) VALUES ('note', 'c', ?1)",
                params![doc_id],
            )
            .unwrap();
            conn.execute("DELETE FROM documents WHERE id = ?1", params![doc_id])
                .unwrap();

            let doc_id: Option<i64> = conn
                .query_row("SELECT document_id FROM notes WHERE id = 1", [], |r| r.get(0))
                .unwrap();
            assert!(doc_id.is_none());
        });
    }
}
