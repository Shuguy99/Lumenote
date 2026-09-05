import { create } from "zustand";
import type {
  ChatMessage,
  ChatSession,
  CitationHighlight,
  Document,
  Note,
  NoteAnchor,
  SearchResult,
} from "./types";
import { chatApi, documentsApi, notesApi, sessionsApi, type StreamEvent } from "./api";

type Theme = "light" | "dark";

interface AppState {
  documents: Document[];
  notes: Note[];
  chat: ChatMessage[];
  sessions: ChatSession[];
  activeSessionId: number | null;
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
  addDocumentFromUrl: (url: string) => Promise<void>;
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
  createSession: (title: string, documentIds: number[], noteId?: number | null) => Promise<number | null>;
  selectSession: (id: number) => Promise<void>;
  deleteSession: (id: number) => Promise<void>;
  updateSessionSources: (documentIds: number[]) => Promise<void>;
  renameSession: (id: number, title: string) => Promise<void>;
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
  sessions: [],
  activeSessionId: null,
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
      const sessions = await sessionsApi.list();
      const activeSessionId = sessions[0]?.id ?? null;
      const [documents, notes, chat] = await Promise.all([
        documentsApi.load(),
        notesApi.list(),
        activeSessionId !== null
          ? chatApi.history(activeSessionId)
          : Promise.resolve([]),
      ]);
      set({ documents, notes, chat, sessions, activeSessionId, isLoading: false });
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

  addDocumentFromUrl: async (url) => {
    try {
      const doc = await documentsApi.addFromUrl(url);
      set((s) => ({
        documents: [doc, ...s.documents],
        viewedDocumentId: doc.id,
      }));
      await get().search(get().searchQuery);
    } catch (e) {
      set({ error: String(e) });
      throw e;
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

  createSession: async (title, documentIds, noteId = null) => {
    try {
      const id = await sessionsApi.create(title, documentIds, noteId);
      await get().selectSession(id);
      return id;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },

  selectSession: async (id) => {
    set({ activeSessionId: id, isChatResponding: false, streamedResponse: null, error: null });
    try {
      const [chat, sessions] = await Promise.all([
        chatApi.history(id),
        sessionsApi.list(),
      ]);
      set({ chat, sessions });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  deleteSession: async (id) => {
    try {
      await sessionsApi.remove(id);
      const sessions = await sessionsApi.list();
      const activeSessionId = sessions[0]?.id ?? null;
      const chat = activeSessionId !== null ? await chatApi.history(activeSessionId) : [];
      set({ sessions, activeSessionId, chat });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  updateSessionSources: async (documentIds) => {
    const { activeSessionId, sessions } = get();
    if (activeSessionId === null) return;
    const session = sessions.find((s) => s.id === activeSessionId);
    if (!session) return;
    if (session.note_id !== null) return;
    const title = session.title;
    try {
      await sessionsApi.update(activeSessionId, title, documentIds);
      set({
        sessions: get().sessions.map((s) =>
          s.id === activeSessionId
            ? { ...s, document_ids: JSON.stringify(documentIds) }
            : s,
        ),
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  renameSession: async (id, title) => {
    const session = get().sessions.find((s) => s.id === id);
    if (!session) return;
    let documentIds: number[] = [];
    try {
      documentIds = JSON.parse(session.document_ids);
    } catch {
      documentIds = [];
    }
    try {
      await sessionsApi.update(id, title, documentIds);
      set({
        sessions: get().sessions.map((s) => (s.id === id ? { ...s, title } : s)),
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  sendChatMessage: async (message) => {
    const { activeSessionId, chat } = get();
    if (!message.trim() || get().isChatResponding || activeSessionId === null) return;

    set({ isChatResponding: true, error: null, streamedResponse: null });
    try {
      const userMsg: ChatMessage = {
        id: Date.now(),
        session_id: activeSessionId,
        role: "user",
        content: message,
        created_at: new Date().toISOString(),
      };
      set({ chat: [...chat, userMsg] });

      const aiMsgId = Date.now() + 1;
      const aiMsg: ChatMessage = {
        id: aiMsgId,
        session_id: activeSessionId,
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

      await chatApi.stream(message, activeSessionId, onEvent);

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
    const { activeSessionId } = get();
    if (activeSessionId === null) return;
    try {
      await chatApi.clear(activeSessionId);
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