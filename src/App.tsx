import { useEffect, useState } from "react";
import Sidebar from "./components/Sidebar";
import DocumentViewer from "./components/DocumentViewer";
import NotesEditor from "./components/NotesEditor";
import ChatPanel from "./components/ChatPanel";
import SettingsModal from "./components/SettingsModal";
import { useAppStore } from "./store";

export default function App() {
  const { loadAll, selectedDocumentId, selectedNoteId } = useAppStore();
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    loadAll();
  }, []);

  const showDocument = selectedDocumentId !== null;
  const showNotes = selectedNoteId !== null;

  return (
    <div className="h-screen w-screen flex bg-gray-50 text-gray-900 overflow-hidden select-none">
      <Sidebar />

      <main className="flex-1 flex h-full overflow-hidden">
        <div className="flex-1 min-w-0 h-full">
          {showDocument && <DocumentViewer />}
          {showNotes && <NotesEditor />}
          {!showDocument && !showNotes && (
            <div className="flex-1 h-full flex items-center justify-center bg-gray-50">
              <div className="text-center max-w-sm">
                <svg
                  className="w-16 h-16 mx-auto mb-4 text-gray-300"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                  />
                </svg>
                <h2 className="text-lg text-gray-700 font-medium mb-1">
                  Добро пожаловать в Lumenote
                </h2>
                <p className="text-sm text-gray-500 mb-4">
                  Загрузите документы слева, создайте заметки и задавайте вопросы
                  AI на панели справа
                </p>
                <div className="flex justify-center gap-2">
                  <span className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded-full">
                    📄 PDF, TXT, MD
                  </span>
                  <span className="text-xs px-2 py-1 bg-emerald-50 text-emerald-700 rounded-full">
                    🤖 AI-чат
                  </span>
                  <span className="text-xs px-2 py-1 bg-amber-50 text-amber-700 rounded-full">
                    📝 Заметки
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        <ChatPanel />
      </main>

      {/* Settings button in bottom-left corner overlay */}
      <button
        onClick={() => setSettingsOpen(true)}
        className="fixed bottom-4 left-4 w-9 h-9 rounded-lg bg-white border border-gray-200 shadow flex items-center justify-center text-gray-500 hover:text-gray-700 hover:shadow-md transition-all z-40"
        title="Настройки"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      </button>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
