import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAppStore } from "../store";
import { parseAnchor, type NoteAnchor } from "../types";
import { escapeRegExp, findTextOffset } from "../anchors";

function highlightText(
  text: string,
  query: string,
  citation?: { offset: number; length: number } | null,
): ReactNode {
  const q = query.trim().toLowerCase();
  if (citation && citation.length > 0) {
    const { offset, length } = citation;
    if (offset >= 0 && offset < text.length) {
      const end = Math.min(offset + length, text.length);
      return (
        <>
          {text.slice(0, offset)}
          <mark className="citation-highlight">
            {text.slice(offset, end)}
          </mark>
          {text.slice(end)}
        </>
      );
    }
  }
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
    notes,
    selectedDocumentId,
    deleteDocument,
    createNote,
    selectNote,
    reloadDocument,
    setCitation,
    searchQuery,
    searchResults,
    citation,
  } = useAppStore();

  const doc = documents.find((d) => d.id === selectedDocumentId);

  const docNotes = useMemo(
    () => notes.filter((n) => n.document_id === doc?.id),
    [notes, doc?.id],
  );

  const [selection, setSelection] = useState<NoteAnchor | null>(null);
  const [selectionPos, setSelectionPos] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const citationMarkRef = useRef<HTMLElement | null>(null);

  const snippetForDoc = useMemo(() => {
    if (!searchQuery.trim()) return null;
    return searchResults.find((r) => r.document_id === doc?.id) ?? null;
  }, [searchResults, searchQuery, doc?.id]);

  useEffect(() => {
    if (citation && citation.documentId === doc?.id) {
      const el = contentScrollRef.current?.querySelector<HTMLElement>(
        "mark.citation-highlight",
      );
      citationMarkRef.current = el ?? null;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("citation-flash");
        const t = setTimeout(() => el.classList.remove("citation-flash"), 1800);
        return () => clearTimeout(t);
      }
    }
  }, [citation, doc?.id]);

  const handleSelect = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !doc) {
      setSelection(null);
      setSelectionPos(null);
      return;
    }
    const text = sel.toString();
    if (!text.trim() || text.length > 400) {
      setSelection(null);
      setSelectionPos(null);
      return;
    }
    const offset = findTextOffset(doc.content, text);
    if (offset < 0) {
      setSelection(null);
      setSelectionPos(null);
      return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const container = contentScrollRef.current;
    const base = container?.getBoundingClientRect();
    const x = base ? rect.left - base.left : rect.left;
    const y = base ? rect.bottom - base.top : rect.bottom;
    setSelection({ offset, length: text.length, text: text.slice(0, 300) });
    setSelectionPos({ x, y });
  };

  const handleAnnotate = async () => {
    if (!selection || !doc) return;
    await createNote(
      `Аннотация: ${selection.text.trim().split("\n")[0].slice(0, 60)}`,
      `> ${selection.text.trim()}\n\n`,
      doc.id,
      selection,
    );
    setSelection(null);
    setSelectionPos(null);
  };

  if (!doc) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-950 text-gray-400">
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
    await createNote(`Заметка о «${doc.title}»`, "", doc.id);
  };

  const handleOpenCitation = (anchor: NoteAnchor | null) => {
    if (!anchor || !doc) return;
    setCitation({ documentId: doc.id, offset: anchor.offset, length: anchor.length });
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
          {doc.file_type !== "url" && (
            <button
              onClick={() => reloadDocument(doc.id)}
              className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 rounded-md transition-colors"
              title="Перечитать файл с диска"
            >
              Обновить
            </button>
          )}
          <button
            onClick={() => deleteDocument(doc.id)}
            className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm text-red-600 dark:text-red-400 rounded-md transition-colors"
          >
            Удалить
          </button>
        </div>
      </div>

      {/* Linked notes */}
      {docNotes.length > 0 && (
        <div className="border-b border-gray-200 dark:border-gray-800 px-6 py-3">
          <h3 className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
            Заметки по этому документу ({docNotes.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {docNotes.map((n) => {
              const anchor = parseAnchor(n.anchor);
              return (
                <button
                  key={n.id}
                  onClick={() => selectNote(n.id)}
                  className="group flex items-center gap-2 text-left text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:border-blue-400 dark:hover:border-blue-500 transition-colors max-w-64"
                >
                  <svg className="w-4 h-4 flex-shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                    />
                  </svg>
                  <span className="truncate text-gray-800 dark:text-gray-200">
                    {n.title || "Без названия"}
                  </span>
                  {anchor && (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenCitation(anchor);
                      }}
                      className="text-blue-600 dark:text-blue-400 hover:underline flex-shrink-0"
                      title="Показать фрагмент"
                    >
                      фрагмент
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

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
      <div className="flex-1 overflow-y-auto px-6 py-4 relative" ref={contentScrollRef}>
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

        <pre
          className="whitespace-pre-wrap font-sans text-sm text-gray-800 dark:text-gray-200 leading-relaxed select-text"
          onMouseUp={handleSelect}
          onMouseDown={() => {
            setSelection(null);
            setSelectionPos(null);
          }}
        >
          {highlightText(doc.content, searchQuery, citation)}
        </pre>

        {selection && selectionPos && (
          <div
            className="absolute z-10"
            style={{
              left: Math.max(0, selectionPos.x),
              top: selectionPos.y + 8,
            }}
          >
            <button
              onClick={handleAnnotate}
              onMouseDown={(e) => e.stopPropagation()}
              className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium shadow-lg hover:bg-blue-700 transition-colors"
            >
              Аннотировать выделение
            </button>
          </div>
        )}
      </div>
    </div>
  );
}