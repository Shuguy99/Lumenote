import { useMemo, type ReactNode } from "react";
import { useAppStore } from "../store";

function highlightText(
  text: string,
  query: string,
): ReactNode {
  const q = query.trim().toLowerCase();
  if (!q) return text;
  const parts = text.split(new RegExp(`(${escapeRegExp(q)})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === q.toLowerCase() ? (
      <mark key={i} className="search-highlight">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function Snippet({
  text,
  query,
  matchIndex,
}: {
  text: string;
  query: string;
  matchIndex: number;
}) {
  const q = query.trim().toLowerCase();
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q, Math.max(0, matchIndex));
  const from = Math.max(0, idx === -1 ? Math.max(0, matchIndex) : idx);
  const lineStart = text.lastIndexOf("\n", from - 1) + 1;
  const lineEndRaw = text.indexOf("\n", from);
  const lineEnd = lineEndRaw === -1 ? text.length : lineEndRaw;
  return (
    <p className="whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
      {highlightText(text.slice(lineStart, lineEnd), query)}
    </p>
  );
}

export default function DocumentViewer() {
  const {
    documents,
    selectedDocumentId,
    deleteDocument,
    createNote,
    searchQuery,
    searchResults,
  } = useAppStore();

  const doc = documents.find((d) => d.id === selectedDocumentId);

  const snippetForDoc = useMemo(() => {
    if (!searchQuery.trim()) return null;
    return searchResults.find((r) => r.document_id === doc?.id) ?? null;
  }, [searchResults, searchQuery, doc?.id]);

  if (!doc) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-900 text-gray-400">
        <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
        <p className="text-sm">Выберите документ для просмотра</p>
      </div>
    );
  }

  const handleNewNoteFromDoc = async () => {
    await createNote(`Заметка о «${doc.title}»`, "");
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  };

  return (
    <div className="flex-1 h-full flex flex-col bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-800 px-6 py-4">
        <h1 className="text-xl font-semibold text-gray-800 dark:text-gray-100">{doc.title}</h1>
        <div className="flex items-center gap-3 mt-1 text-sm text-gray-500 dark:text-gray-400">
          <span>Тип: {doc.file_type.toUpperCase()}</span>
          <span>·</span>
          <span>{formatSize(doc.size)}</span>
          <span>·</span>
          <span>{doc.created_at}</span>
        </div>
        <div className="flex gap-2 mt-3">
          <button
            onClick={handleNewNoteFromDoc}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-md transition-colors"
          >
            Создать заметку из документа
          </button>
          <button
            onClick={() => deleteDocument(doc.id)}
            className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm text-red-600 dark:text-red-400 rounded-md transition-colors"
          >
            Удалить
          </button>
        </div>
      </div>

      {/* Summary */}
      {doc.summary && (
        <div className="border-b border-gray-100 dark:border-gray-800 bg-blue-50 dark:bg-blue-950/50 px-6 py-4">
          <h2 className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-2">
            Сводка (AI)
          </h2>
          <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
            {doc.summary}
          </p>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {searchQuery.trim() !== "" && snippetForDoc ? (
          <div className="mb-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-4 py-3 text-xs text-amber-800 dark:text-amber-300">
            Найдено вхождение:
            <div className="mt-1">
              <Snippet
                text={doc.content}
                query={searchQuery}
                matchIndex={snippetForDoc.match_index}
              />
            </div>
          </div>
        ) : null}
        <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
          {highlightText(doc.content, searchQuery)}
        </pre>
      </div>
    </div>
  );
}
