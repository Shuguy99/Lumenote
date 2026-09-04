import { useAppStore } from "../store";

export default function DocumentViewer() {
  const { documents, selectedDocumentId, deleteDocument, createNote } =
    useAppStore();

  const doc = documents.find((d) => d.id === selectedDocumentId);

  if (!doc) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center bg-gray-50 text-gray-400">
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
    <div className="flex-1 h-full flex flex-col bg-white">
      {/* Header */}
      <div className="border-b border-gray-200 px-6 py-4">
        <h1 className="text-xl font-semibold text-gray-800">{doc.title}</h1>
        <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
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
            className="px-3 py-1.5 border border-gray-300 hover:bg-gray-50 text-sm text-red-600 rounded-md transition-colors"
          >
            Удалить
          </button>
        </div>
      </div>

      {/* Summary */}
      {doc.summary && (
        <div className="border-b border-gray-100 bg-blue-50 px-6 py-4">
          <h2 className="text-sm font-semibold text-blue-800 mb-2">
            Сводка (AI)
          </h2>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">
            {doc.summary}
          </p>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800 leading-relaxed">
          {doc.content}
        </pre>
      </div>
    </div>
  );
}
