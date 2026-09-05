import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAppStore } from "../store";
import { parseAnchor } from "../types";

export default function NotesEditor() {
  const {
    notes,
    documents,
    selectedNoteId,
    updateNote,
    deleteNote,
    selectDocument,
    createSession,
  } = useAppStore();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [loadedId, setLoadedId] = useState<number | null>(null);

  const note = notes.find((n) => n.id === selectedNoteId);

  useEffect(() => {
    if (note && note.id !== loadedId) {
      setTitle(note.title);
      setContent(note.content);
      setLoadedId(note.id);
      setMode("edit");
    }
  }, [note, loadedId]);

  const handleTitleChange = (value: string) => {
    setTitle(value);
    if (note) {
      updateNote(note.id, value, content, note.document_id, note.anchor);
    }
  };

  const handleContentChange = (value: string) => {
    setContent(value);
    if (note) {
      updateNote(note.id, title, value, note.document_id, note.anchor);
    }
  };

  const linkedDoc = note
    ? documents.find((d) => d.id === note.document_id)
    : undefined;
  const anchor = note ? parseAnchor(note.anchor) : null;

  const handleOpenSource = () => {
    if (!note) return;
    if (note.document_id != null) {
      selectDocument(
        note.document_id,
        anchor
          ? {
              documentId: note.document_id,
              offset: anchor.offset,
              length: anchor.length,
            }
          : null,
      );
    }
  };

  if (!note) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-900 text-gray-400">
        <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
          />
        </svg>
        <p className="text-sm">Выберите заметку или создайте новую</p>
      </div>
    );
  }

  return (
    <div className="flex-1 h-full flex flex-col bg-white dark:bg-gray-900">
      <div className="border-b border-gray-200 dark:border-gray-800 px-6 py-3 flex items-center justify-between">
        <div className="flex-1 pr-4">
          <input
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            className="w-full text-lg font-semibold text-gray-800 dark:text-gray-100 bg-transparent outline-none"
            placeholder="Заголовок заметки"
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="bg-gray-100 dark:bg-gray-800 rounded-lg flex">
            <button
              onClick={() => setMode("edit")}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                mode === "edit"
                  ? "bg-white dark:bg-gray-700 shadow dark:text-gray-100"
                  : "text-gray-600 dark:text-gray-400"
              }`}
            >
              Редактор
            </button>
            <button
              onClick={() => setMode("preview")}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                mode === "preview"
                  ? "bg-white dark:bg-gray-700 shadow dark:text-gray-100"
                  : "text-gray-600 dark:text-gray-400"
              }`}
            >
              Просмотр
            </button>
          </div>
          <button
            onClick={() => deleteNote(note.id)}
            className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
            title="Удалить"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
          <button
            onClick={() => createSession(`Заметка: ${note.title}`, [], note.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium transition-colors"
            title="Открыть чат об этой заметке"
          >
            <span className="w-4 h-4 rounded bg-white/20 flex items-center justify-center text-[9px] font-bold">
              AI
            </span>
            Обсудить
          </button>
        </div>
      </div>

      {linkedDoc && (
        <div className="px-6 py-2 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5m9.94-1.5l1.5-1.5a4 4 0 10-5.656-5.656l-3 3a4 4 0 005.656 5.656"
            />
          </svg>
          <span className="truncate">
            Связано с: {linkedDoc.title}
            {anchor ? " · фрагмент" : ""}
          </span>
          <button
            onClick={handleOpenSource}
            className="ml-auto flex-shrink-0 text-blue-600 dark:text-blue-400 hover:underline"
          >
            {anchor ? "К фрагменту" : "Открыть документ"}
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {mode === "edit" ? (
          <textarea
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            className="w-full h-full min-h-64 bg-transparent text-sm text-gray-800 dark:text-gray-100 outline-none resize-none font-sans leading-relaxed placeholder:text-gray-400 dark:placeholder:text-gray-500"
            placeholder="Пишите в Markdown... (поддерживаются # заголовки, **жирный**, списки и т.д.)"
          />
        ) : (
          <div className="markdown-body text-sm text-gray-800 dark:text-gray-100">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content || "*Пустая заметка*"}
            </ReactMarkdown>
          </div>
        )}
      </div>

      <div className="px-6 py-2 text-xs text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-800">
        Последнее обновление: {note.updated_at}
      </div>
    </div>
  );
}
