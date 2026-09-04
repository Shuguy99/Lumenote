import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAppStore } from "../store";

export default function NotesEditor() {
  const { notes, selectedNoteId, updateNote, deleteNote } = useAppStore();
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
      updateNote(note.id, value, content, note.document_id);
    }
  };

  const handleContentChange = (value: string) => {
    setContent(value);
    if (note) {
      updateNote(note.id, title, value, note.document_id);
    }
  };

  if (!note) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center bg-gray-50 text-gray-400">
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
    <div className="flex-1 h-full flex flex-col bg-white">
      <div className="border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex-1 pr-4">
          <input
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            className="w-full text-lg font-semibold text-gray-800 bg-transparent outline-none"
            placeholder="Заголовок заметки"
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="bg-gray-100 rounded-lg flex">
            <button
              onClick={() => setMode("edit")}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                mode === "edit" ? "bg-white shadow" : "text-gray-600"
              }`}
            >
              Редактор
            </button>
            <button
              onClick={() => setMode("preview")}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                mode === "preview" ? "bg-white shadow" : "text-gray-600"
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
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {mode === "edit" ? (
          <textarea
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            className="w-full h-full min-h-64 bg-transparent text-sm text-gray-800 outline-none resize-none font-sans leading-relaxed"
            placeholder="Пишите в Markdown... (поддерживаются # заголовки, **жирный**, списки и т.д.)"
          />
        ) : (
          <div className="markdown-body text-sm text-gray-800">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content || "*Пустая заметка*"}
            </ReactMarkdown>
          </div>
        )}
      </div>

      <div className="px-6 py-2 text-xs text-gray-400 border-t border-gray-100">
        Последнее обновление: {note.updated_at}
      </div>
    </div>
  );
}
