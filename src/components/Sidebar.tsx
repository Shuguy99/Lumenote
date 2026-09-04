import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../store";

export default function Sidebar() {
  const {
    documents,
    notes,
    selectedDocumentId,
    selectedNoteId,
    selectDocument,
    selectNote,
    addDocument,
    deleteDocument,
    deleteNote,
    createNote,
    viewedDocumentId,
    setError,
  } = useAppStore();

  const [docExpanded, setDocExpanded] = useState(true);
  const [notesExpanded, setNotesExpanded] = useState(true);

  const handleAddDocument = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [
          { name: "Documents", extensions: ["pdf", "txt", "md", "markdown", "json", "csv"] },
          { name: "PDF", extensions: ["pdf"] },
          { name: "Text", extensions: ["txt", "md", "markdown"] },
        ],
      });

      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        for (const p of paths) {
          await addDocument(p);
        }
      }
    } catch (e) {
      setError(String(e));
    }
  };

  const handleNewNote = async () => {
    await createNote("Новая заметка", "");
  };

  return (
    <aside className="w-72 min-w-72 bg-white border-r border-gray-200 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <h1 className="text-lg font-bold text-gray-800 flex items-center gap-2">
          <span className="w-6 h-6 rounded-md bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
            AI
          </span>
          Lumenote
        </h1>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Sources */}
        <div className="border-b border-gray-100">
          <div className="flex items-center justify-between px-4 py-3">
            <button
              className="flex items-center gap-2 text-sm font-medium text-gray-700"
              onClick={() => setDocExpanded(!docExpanded)}
            >
              <svg
                className={`w-3 h-3 transition-transform ${docExpanded ? "rotate-90" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <span className="text-xs uppercase tracking-wide text-gray-500">
                Источники ({documents.length})
              </span>
            </button>
            <button
              onClick={handleAddDocument}
              className="w-6 h-6 rounded hover:bg-gray-100 flex items-center justify-center text-gray-500 hover:text-gray-700"
              title="Добавить документ"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>

          {docExpanded && (
            <div className="pb-2">
              {documents.length === 0 ? (
                <p className="px-4 py-2 text-xs text-gray-400 italic">
                  Нет документов. Нажмите + чтобы загрузить.
                </p>
              ) : (
                documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="group flex items-center gap-2 px-4 py-2 hover:bg-gray-50 cursor-pointer"
                    onClick={() => selectDocument(doc.id)}
                  >
                    <div
                      className={`flex-1 min-w-0 rounded px-1 py-0.5 ${
                        selectedDocumentId === doc.id
                          ? "bg-blue-50"
                          : viewedDocumentId === doc.id
                            ? "bg-gray-50"
                            : ""
                      }`}
                    >
                      <p className="text-sm text-gray-800 truncate">{doc.title}</p>
                      <p className="text-xs text-gray-400">{doc.file_type.toUpperCase()}</p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteDocument(doc.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center text-gray-400 hover:text-red-500"
                      title="Удалить"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Notes */}
        <div>
          <div className="flex items-center justify-between px-4 py-3">
            <button
              className="flex items-center gap-2 text-sm font-medium text-gray-700"
              onClick={() => setNotesExpanded(!notesExpanded)}
            >
              <svg
                className={`w-3 h-3 transition-transform ${notesExpanded ? "rotate-90" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <span className="text-xs uppercase tracking-wide text-gray-500">
                Заметки ({notes.length})
              </span>
            </button>
            <button
              onClick={handleNewNote}
              className="w-6 h-6 rounded hover:bg-gray-100 flex items-center justify-center text-gray-500 hover:text-gray-700"
              title="Новая заметка"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>

          {notesExpanded && (
            <div className="pb-2">
              {notes.length === 0 ? (
                <p className="px-4 py-2 text-xs text-gray-400 italic">
                  Пока нет заметок. Нажмите +.
                </p>
              ) : (
                notes.map((note) => (
                  <div
                    key={note.id}
                    className="group flex items-center gap-2 px-4 py-2 hover:bg-gray-50 cursor-pointer"
                    onClick={() => selectNote(note.id)}
                  >
                    <div
                      className={`flex-1 min-w-0 rounded px-1 py-0.5 ${
                        selectedNoteId === note.id ? "bg-blue-50" : ""
                      }`}
                    >
                      <p className="text-sm text-gray-800 truncate">
                        {note.title || "Без названия"}
                      </p>
                      <p className="text-xs text-gray-400">
                        {note.content
                          ? note.content.slice(0, 40)
                          : "Пустая заметка"}
                        {note.content.length > 40 ? "..." : ""}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteNote(note.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center text-gray-400 hover:text-red-500"
                      title="Удалить"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
