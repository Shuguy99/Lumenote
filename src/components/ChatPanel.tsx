import { useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAppStore } from "../store";
import { exportApi } from "../api";
import { findTextOffset } from "../anchors";

const CITATION_RE = /\[Doc:\s*([^\]]+)\]/g;

function processCitations(content: string): string {
  let result = "";
  let last = 0;
  let m: RegExpExecArray | null;
  CITATION_RE.lastIndex = 0;
  while ((m = CITATION_RE.exec(content))) {
    const title = m[1].trim();
    if (!title) continue;
    const ctxStart = Math.max(0, m.index - 200);
    const ctx = content.slice(ctxStart, m.index).trim().split("\n").pop()?.slice(-150) ?? "";
    const href = `cite://${encodeURIComponent(title)}|${encodeURIComponent(ctx)}`;
    result += content.slice(last, m.index);
    result += `[${m[0]}]( ${href} )`;
    last = m.index + m[0].length;
  }
  result += content.slice(last);
  return result;
}

function CitationLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  const { documents, selectDocument, setError } = useAppStore();

  if (!href.startsWith("cite://")) {
    return <a href={href}>{children}</a>;
  }

  const handleClick = () => {
    const raw = href.slice("cite://".length);
    const sep = raw.indexOf("|");
    const title = decodeURIComponent(raw.slice(0, sep === -1 ? raw.length : sep));
    const ctx = sep === -1 ? "" : decodeURIComponent(raw.slice(sep + 1));

    const doc =
      documents.find((d) => d.title.toLowerCase() === title.toLowerCase()) ??
      documents.find((d) =>
        d.title.toLowerCase().includes(title.toLowerCase()),
      ) ??
      documents.find((d) => title.toLowerCase().includes(d.title.toLowerCase()));

    if (!doc) {
      setError(`Документ не найден: ${title}`);
      return;
    }

    const offset = ctx ? findTextOffset(doc.content, ctx) : -1;
    if (offset >= 0) {
      selectDocument(doc.id, {
        documentId: doc.id,
        offset,
        length: ctx.length,
      });
    } else {
      selectDocument(doc.id, null);
    }
  };

  return (
    <button
      onClick={handleClick}
      className="text-blue-600 dark:text-blue-400 hover:underline font-medium cursor-pointer"
      title="Открыть фрагмент документа"
    >
      {children}
    </button>
  );
}

function suggestedQuestions(
  documents: { id: number; title: string }[],
  noteTitle: string | null,
): string[] {
  if (noteTitle) {
    return [
      `Кратко резюмируй заметку «${noteTitle}»`,
      `Выдели ключевые тезисы из заметки «${noteTitle}»`,
      `О чем стоит спросить на основе «${noteTitle}»?`,
    ];
  }
  if (documents.length === 0) {
    return ["Привет! Чем могу помочь?"];
  }
  const first = documents[0].title;
  const qs: string[] = [
    "Сделай сводку по выбранным документам",
    "Выдели ключевые тезисы и главные выводы",
  ];
  if (documents.length === 1) {
    qs.push(`Что такое «${first}»? Основные идеи`);
    qs.push(`О чем говорит «${first}»? Разверни`);
  } else {
    qs.push(`Сравни «${first}» и остальные выбранные документы`);
  }
  qs.push("Распиши подробный план по этой теме");
  return qs;
}

function parseDocIds(raw: string): number[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is number => typeof x === "number") : [];
  } catch {
    return [];
  }
}

export default function ChatPanel() {
  const {
    chat,
    isChatResponding,
    streamedResponse,
    sendChatMessage,
    documents,
    sessions,
    activeSessionId,
    createSession,
    selectSession,
    deleteSession,
    updateSessionSources,
    setError,
    error,
  } = useAppStore();
  const [input, setInput] = useState("");
  const [showSources, setShowSources] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const activeDocIds = activeSession ? parseDocIds(activeSession.document_ids) : [];
  const isNoteSession = !!activeSession?.note_id;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, isChatResponding, activeSessionId]);

  const handleSend = (text?: string) => {
    const content = (text ?? input).trim();
    if (!content) return;
    sendChatMessage(content);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewSession = async () => {
    await createSession("Новый чат", []);
    setShowSources(false);
  };

  const [exporting, setExporting] = useState<boolean>(false);
  const handleExport = async (kind: "md" | "pdf") => {
    if (activeSessionId === null || !activeSession) return;
    setExporting(true);
    try {
      const savedPath =
        kind === "md"
          ? await exportApi.saveChatMd(activeSessionId, activeSession.title)
          : await exportApi.saveChatPdf(activeSessionId, activeSession.title);
      if (savedPath) {
        setError(`Диалог экспортирован: ${savedPath}`);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setExporting(false);
    }
  };

  const toggleSource = (docId: number) => {
    if (isNoteSession) return;
    const next = activeDocIds.includes(docId)
      ? activeDocIds.filter((d) => d !== docId)
      : [...activeDocIds, docId];
    updateSessionSources(next);
  };

  const lastAssistantId = [...chat]
    .reverse()
    .find((m) => m.role === "assistant")?.id;

  const suggestions = suggestedQuestions(
    activeDocIds
      .map((id) => documents.find((d) => d.id === id))
      .filter((d): d is NonNullable<typeof d> => Boolean(d)),
    isNoteSession ? "этой заметки" : null,
  );

  return (
    <div className="w-[26rem] min-w-[26rem] border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-800 px-4 py-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <span className="w-5 h-5 rounded bg-emerald-500 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
              AI
            </span>
            <select
              value={activeSessionId ?? ""}
              onChange={(e) => selectSession(Number(e.target.value))}
              className="bg-transparent outline-none text-sm font-medium cursor-pointer max-w-[14rem] truncate"
              title="Переключить сессию чата"
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </h2>
          <p className="text-xs text-gray-400 mt-0.5 truncate">
            {isNoteSession
              ? "Обсуждение заметки"
              : activeDocIds.length > 0
                ? `Источники: ${activeDocIds.length}`
                : documents.length > 0
                  ? "Выберите источники ниже"
                  : "Загрузите документы для оценки"}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <div className="relative group">
            <button
              disabled={exporting || activeSessionId === null || chat.length === 0}
              className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Экспорт диалога (.md / .pdf)"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3"
                />
              </svg>
            </button>
            <div className="hidden group-hover:block absolute right-0 mt-1 w-40 rounded-lg bg-white dark:bg-gray-800 shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-20">
              <button
                onClick={() => handleExport("md")}
                disabled={exporting || activeSessionId === null || chat.length === 0}
                className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
              >
                В .md
              </button>
              <button
                onClick={() => handleExport("pdf")}
                disabled={exporting || activeSessionId === null || chat.length === 0}
                className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
              >
                В PDF
              </button>
            </div>
          </div>
          <button
            onClick={() => setShowSources((v) => !v)}
            className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
            title="Выбор источников"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h7"
              />
            </svg>
          </button>
          <button
            onClick={handleNewSession}
            className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
            title="Новая сессия чата"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 5v14m7-7H5"
              />
            </svg>
          </button>
          {activeSessionId !== null && (
            <button
              onClick={() => {
                if (confirm(`Удалить сессию «${activeSession?.title ?? ""}» и всю её историю?`)) {
                  deleteSession(activeSessionId);
                }
              }}
              className="text-gray-400 dark:text-gray-500 hover:text-red-500 p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950/30"
              title="Удалить сессию"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 0V4a1 1 0 011-1h2a1 1 0 011 1v3m-8 0h16"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Sources panel */}
      {showSources && !isNoteSession && (
        <div className="border-b border-gray-200 dark:border-gray-800 px-4 py-3 bg-gray-50 dark:bg-gray-800/60 max-h-48 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-gray-600 dark:text-gray-300">
              Источники для этой сессии
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => updateSessionSources(documents.map((d) => d.id))}
                className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
              >
                Все
              </button>
              <button
                onClick={() => updateSessionSources([])}
                className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
              >
                Очистить
              </button>
            </div>
          </div>
          {documents.length === 0 ? (
            <p className="text-xs text-gray-400">Нет загруженных документов</p>
          ) : (
            <ul className="space-y-1">
              {documents.map((doc) => {
                const checked = activeDocIds.includes(doc.id);
                return (
                  <li key={doc.id}>
                    <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50 rounded px-1 py-0.5">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSource(doc.id)}
                        className="rounded accent-blue-600"
                      />
                      <span className="truncate">{doc.title}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="px-4 py-2 bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400 text-xs border-b border-red-100 dark:border-red-900 flex items-center justify-between gap-2">
          <span className="truncate">{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-red-400 hover:text-red-600 flex-shrink-0"
          >
            ×
          </button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {chat.length === 0 && (
          <div className="text-center text-gray-400 text-sm mt-8 px-4">
            <svg className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
              />
            </svg>
            <p>Задайте вопрос о ваших документах</p>
            <p className="text-xs mt-1">
              AI ответит на основе выбранных источников
            </p>
          </div>
        )}

        {chat.length === 0 && (
          <div className="flex flex-wrap gap-1.5 justify-center px-2">
            {suggestions.map((q) => (
              <button
                key={q}
                onClick={() => handleSend(q)}
                className="px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-300 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {chat.map((msg) => (
          <div
            key={msg.id}
            className={`chat-message ${msg.role === "user" ? "flex justify-end" : ""}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                msg.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-100"
              }`}
            >
              {msg.role === "assistant" ? (
                <div className="markdown-body text-sm">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ href, children }) => {
                        const h = typeof href === "string" ? href : "";
                        return (
                          <CitationLink href={h}>{children}</CitationLink>
                        );
                      },
                    }}
                  >
                    {processCitations(msg.content)}
                  </ReactMarkdown>
                  {isChatResponding &&
                    msg.id === lastAssistantId &&
                    streamedResponse == null && (
                      <span className="inline-flex items-center gap-1 ml-1 align-baseline">
                        <span className="typing-dot w-1.5 h-1.5 rounded-full bg-gray-400" />
                        <span
                          className="typing-dot w-1.5 h-1.5 rounded-full bg-gray-400"
                          style={{ animationDelay: "0.2s" }}
                        />
                        <span
                          className="typing-dot w-1.5 h-1.5 rounded-full bg-gray-400"
                          style={{ animationDelay: "0.4s" }}
                        />
                      </span>
                    )}
                </div>
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}

        {isChatResponding && !lastAssistantId && (
          <div className="chat-message">
            <div className="bg-gray-100 dark:bg-gray-800 rounded-2xl px-4 py-3 inline-flex items-center gap-1.5">
              <span className="typing-dot w-2 h-2 rounded-full bg-gray-400" />
              <span className="typing-dot w-2 h-2 rounded-full bg-gray-400" />
              <span className="typing-dot w-2 h-2 rounded-full bg-gray-400" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 dark:border-gray-800 p-4">
        <div className="flex items-end gap-2 bg-gray-50 dark:bg-gray-800 rounded-xl px-3 py-2 border border-gray-200 dark:border-gray-700 focus-within:border-blue-400 transition-colors">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Спросите AI..."
            rows={1}
            className="flex-1 bg-transparent text-sm text-gray-800 dark:text-gray-100 outline-none resize-none min-h-5 max-h-32 placeholder:text-gray-400 dark:placeholder:text-gray-500"
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || isChatResponding}
            className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M3.478 2.404a.75.75 0 00-.926.941l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.404z" />
            </svg>
          </button>
        </div>
        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1.5">
          Enter — отправить, Shift+Enter — новая строка · {isChatResponding ? "AI отвечает…" : "Источники: " + (activeDocIds.length || "нет")}
        </p>
      </div>
    </div>
  );
}