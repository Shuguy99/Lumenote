import { create } from "zustand";
import type {
  ChatMessage,
  CitationHighlight,
  Document,
  Note,
  NoteAnchor,
  SearchResult,
} from "./types";
import { chatApi, documentsApi, notesApi, type StreamEvent } from "./api";

type Theme = "light" | "dark";

interface AppState {
  documents: Document[];
  notes: Note[];
  chat: ChatMessage[];
  selectedDocumentId: number | null;
  selectedNoteId: number | null;
  viewedDocumentId: number | null;
  citation: CitationHighlight | null;
  isLoading: boolean;
  error: string | null;
  isChatResponding: boolean;
  streamedResponse: string | null;
  searchQuery: string;
  searchResults: SearchResult[];
  isSearching: boolean;
  theme: Theme;

  loadAll: () => Promise<void>;
  addDocument: (path: string) => Promise<void>;
  deleteDocument: (id: number) => Promise<void>;
  createNote: (
    title: string,
    content: string,
    documentId?: number | null,
    anchor?: NoteAnchor | null,
  ) => Promise<void>;
  updateNote: (
    id: number,
    title: string,
    content: string,
    documentId: number | null,
    anchor: string | null,
  ) => Promise<void>;
  deleteNote: (id: number) => Promise<void>;
  selectDocument: (id: number | null, citation?: CitationHighlight | null) => void;
  selectNote: (id: number | null) => void;
  setCitation: (citation: CitationHighlight | null) => void;
  setError: (error: string | null) => void;
  sendChatMessage: (message: string) => Promise<void>;
  clearChat: () => Promise<void>;
  search: (query: string) => Promise<void>;
  openSearchResult: (documentId: number) => void;
  clearSearch: () => void;
  toggleTheme: () => void;
}

function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem("lumenote-theme");
    return saved === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  documents: [],
  notes: [],
  chat: [],
  selectedDocumentId: null,
  selectedNoteId: null,
  viewedDocumentId: null,
  citation: null,
  isLoading: false,
  error: null,
  isChatResponding: false,
  streamedResponse: null,
  searchQuery: "",
  searchResults: [],
  isSearching: false,
  theme: loadTheme(),

  loadAll: async () => {
    set({ isLoading: true, error: null });
    try {
      const [documents, notes, chat] = await Promise.all([
        documentsApi.load(),
        notesApi.list(),
        chatApi.history(),
      ]);
      set({ documents, notes, chat, isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  addDocument: async (path) => {
    try {
      const doc = await documentsApi.add(path);
      set((s) => ({
        documents: [doc, ...s.documents],
        viewedDocumentId: doc.id,
      }));
      await get().search(get().searchQuery);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  deleteDocument: async (id) => {
    try {
      await documentsApi.remove(id);
      set((s) => ({
        documents: s.documents.filter((d) => d.id !== id),
        selectedDocumentId:
          s.selectedDocumentId === id ? null : s.selectedDocumentId,
        viewedDocumentId: s.viewedDocumentId === id ? null : s.viewedDocumentId,
      }));
      await get().search(get().searchQuery);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  createNote: async (title, content, documentId = null, anchor = null) => {
    try {
      const id = await notesApi.create(
        title,
        content,
        documentId,
        anchor ? JSON.stringify(anchor) : null,
      );
      set((s) => ({
        notes: [
          {
            id,
            title,
            content,
            document_id: documentId,
            anchor: anchor ? JSON.stringify(anchor) : null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          ...s.notes,
        ],
        selectedNoteId: id,
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  updateNote: async (id, title, content, documentId, anchor) => {
    try {
      await notesApi.update(id, title, content, documentId, anchor);
      set((s) => ({
        notes: s.notes.map((n) =>
          n.id === id
            ? {
                ...n,
                title,
                content,
                document_id: documentId,
                anchor,
                updated_at: new Date().toISOString(),
              }
            : n,
        ),
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  deleteNote: async (id) => {
    try {
      await notesApi.remove(id);
      set((s) => ({
        notes: s.notes.filter((n) => n.id !== id),
        selectedNoteId: s.selectedNoteId === id ? null : s.selectedNoteId,
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  selectDocument: (id, citation = null) =>
    set({
      selectedDocumentId: id,
      selectedNoteId: null,
      citation: citation ?? null,
    }),
  selectNote: (id) => set({ selectedNoteId: id, selectedDocumentId: null }),
  setCitation: (citation) => set({ citation }),
  setError: (error) => set({ error }),

  sendChatMessage: async (message) => {
    const { chat, selectedDocumentId, documents } = get();
    if (!message.trim() || get().isChatResponding) return;

    set({ isChatResponding: true, error: null, streamedResponse: null });
    try {
      const userMsg: ChatMessage = {
        id: Date.now(),
        role: "user",
        content: message,
        created_at: new Date().toISOString(),
      };
      set({ chat: [...chat, userMsg] });

      const activeDocIds = selectedDocumentId
        ? [selectedDocumentId]
        : documents.map((d) => d.id);

      const aiMsgId = Date.now() + 1;
      const aiMsg: ChatMessage = {
        id: aiMsgId,
        role: "assistant",
        content: "",
        created_at: new Date().toISOString(),
      };
      set({ chat: [...get().chat, aiMsg] });

      let accumulated = "";

      const onEvent = (event: StreamEvent) => {
        if (event.type === "chunk" && event.text) {
          accumulated += event.text;
          set({
            chat: get().chat.map((m) =>
              m.id === aiMsgId ? { ...m, content: accumulated } : m,
            ),
            streamedResponse: accumulated,
          });
        } else if (event.type === "error" && event.message) {
          set({ error: event.message, isChatResponding: false });
        }
      };

      await chatApi.stream(message, activeDocIds, onEvent);

      set({
        chat: get().chat.map((m) =>
          m.id === aiMsgId ? { ...m, content: accumulated } : m,
        ),
        streamedResponse: null,
      });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ isChatResponding: false });
    }
  },

  clearChat: async () => {
    try {
      await chatApi.clear();
      set({ chat: [] });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  search: async (query) => {
    const trimmed = query.trim();
    if (!trimmed) {
      set({ searchQuery: query, searchResults: [], isSearching: false });
      return;
    }
    set({ searchQuery: query, isSearching: true });
    try {
      const results = await documentsApi.search(trimmed);
      set({ searchResults: results, isSearching: false });
    } catch (e) {
      set({ error: String(e), isSearching: false });
    }
  },

  openSearchResult: (documentId) => {
    set({
      selectedDocumentId: documentId,
      selectedNoteId: null,
      viewedDocumentId: documentId,
    });
  },

  clearSearch: () => {
    set({ searchQuery: "", searchResults: [] });
  },

  toggleTheme: () => {
    const next: Theme = get().theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem("lumenote-theme", next);
    } catch {
      /* ignore */
    }
    set({ theme: next });
    document.documentElement.classList.toggle("dark", next === "dark");
  },
}));