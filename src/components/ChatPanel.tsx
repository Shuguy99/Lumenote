import { useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAppStore } from "../store";
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

export default function ChatPanel() {
  const {
    chat,
    isChatResponding,
    streamedResponse,
    sendChatMessage,
    clearChat,
    documents,
    selectedDocumentId,
    setError,
    error,
  } = useAppStore();
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, isChatResponding]);

  const handleSend = () => {
    if (!input.trim()) return;
    sendChatMessage(input);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const activeDoc = documents.find((d) => d.id === selectedDocumentId);
  const lastAssistantId = [...chat]
    .reverse()
    .find((m) => m.role === "assistant")?.id;

  return (
    <div className="w-96 min-w-96 border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <span className="w-5 h-5 rounded bg-emerald-500 flex items-center justify-center text-white text-[10px] font-bold">
              AI
            </span>
            Чат
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {activeDoc
              ? `Вопросы по: ${activeDoc.title}`
              : documents.length > 0
                ? "Вопросы по всем документам"
                : "Загрузите документы для оценки"}
          </p>
        </div>
        <button
          onClick={clearChat}
          className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
          title="Очистить чат"
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
      </div>

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
              AI ответит на основе загруженных источников
            </p>
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
            onClick={handleSend}
            disabled={!input.trim() || isChatResponding}
            className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M3.478 2.404a.75.75 0 00-.926.941l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.404z" />
            </svg>
          </button>
        </div>
        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1.5">
          Enter — отправить, Shift+Enter — новая строка
        </p>
      </div>
    </div>
  );
}
