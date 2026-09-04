import { create } from "zustand";
import type { ChatMessage, Document, Note } from "./types";
import { chatApi, documentsApi, notesApi } from "./api";

interface AppState {
  documents: Document[];
  notes: Note[];
  chat: ChatMessage[];
  selectedDocumentId: number | null;
  selectedNoteId: number | null;
  viewedDocumentId: number | null;
  isLoading: boolean;
  error: string | null;
  isChatResponding: boolean;

  loadAll: () => Promise<void>;
  addDocument: (path: string) => Promise<void>;
  deleteDocument: (id: number) => Promise<void>;
  createNote: (title: string, content: string) => Promise<void>;
  updateNote: (
    id: number,
    title: string,
    content: string,
    documentId: number | null,
  ) => Promise<void>;
  deleteNote: (id: number) => Promise<void>;
  selectDocument: (id: number | null) => void;
  selectNote: (id: number | null) => void;
  setError: (error: string | null) => void;
  sendChatMessage: (message: string) => Promise<void>;
  clearChat: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  documents: [],
  notes: [],
  chat: [],
  selectedDocumentId: null,
  selectedNoteId: null,
  viewedDocumentId: null,
  isLoading: false,
  error: null,
  isChatResponding: false,

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
    } catch (e) {
      set({ error: String(e) });
    }
  },

  createNote: async (title, content) => {
    try {
      const id = await notesApi.create(title, content, null);
      set((s) => ({
        notes: [
          {
            id,
            title,
            content,
            document_id: null,
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

  updateNote: async (id, title, content, documentId) => {
    try {
      await notesApi.update(id, title, content, documentId);
      set((s) => ({
        notes: s.notes.map((n) =>
          n.id === id
            ? {
                ...n,
                title,
                content,
                document_id: documentId,
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

  selectDocument: (id) => set({ selectedDocumentId: id }),
  selectNote: (id) => set({ selectedNoteId: id }),
  setError: (error) => set({ error }),

  sendChatMessage: async (message) => {
    const { chat, selectedDocumentId, documents } = get();
    if (!message.trim() || get().isChatResponding) return;

    set({ isChatResponding: true, error: null });
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

      const response = await chatApi.send(message, activeDocIds);
      const aiMsg: ChatMessage = {
        id: Date.now() + 1,
        role: "assistant",
        content: response,
        created_at: new Date().toISOString(),
      };
      set({ chat: [...get().chat, aiMsg] });
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
}));
