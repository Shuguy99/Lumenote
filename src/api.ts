import { invoke, Channel } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type {
  AiSettings,
  ChatMessage,
  ChatSession,
  Document,
  Note,
  SaveSettingsInput,
  SearchResult,
} from "./types";

export interface StreamEvent {
  type: "chunk" | "done" | "error";
  text?: string;
  message?: string;
}

async function pickSavePath(
  suggestions: string[],
  filters: { name: string; extensions: string[] }[],
): Promise<string | null> {
  return await save({ defaultPath: suggestions[0], filters });
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 60) || "export";
}

export const documentsApi = {
  load: () => invoke<Document[]>("load_documents"),
  add: (path: string) => invoke<Document>("add_document", { path }),
  addFromUrl: (url: string) =>
    invoke<Document>("add_document_from_url", { url: url.trim() }),
  get: (id: number) => invoke<Document | null>("get_document", { id }),
  remove: (id: number) => invoke<void>("delete_document", { id }),
  search: (query: string) =>
    invoke<SearchResult[]>("search_documents", { query }),
};

export const notesApi = {
  list: () => invoke<Note[]>("list_notes"),
  get: (id: number) => invoke<Note | null>("get_note", { id }),
  create: (
    title: string,
    content: string,
    documentId: number | null,
    anchor: string | null,
  ) => invoke<number>("create_note", { title, content, documentId, anchor }),
  update: (
    id: number,
    title: string,
    content: string,
    documentId: number | null,
    anchor: string | null,
  ) => invoke<void>("edit_note", { id, title, content, documentId, anchor }),
  remove: (id: number) => invoke<void>("delete_note", { id }),
};

export const chatApi = {
  history: (sessionId: number) =>
    invoke<ChatMessage[]>("get_chat_history", { sessionId }),
  clear: (sessionId: number) =>
    invoke<void>("clear_chat_history", { sessionId }),
  send: (message: string, sessionId: number) =>
    invoke<string>("send_chat_message", { message, sessionId }),
  stream: (
    message: string,
    sessionId: number,
    onEvent: (event: StreamEvent) => void,
  ): Promise<void> => {
    const channel = new Channel<StreamEvent>();
    channel.onmessage = onEvent;
    return invoke<void>("stream_chat_message", {
      message,
      sessionId,
      onEvent: channel,
    });
  },
};

export const sessionsApi = {
  list: () => invoke<ChatSession[]>("list_chat_sessions"),
  get: (id: number) => invoke<ChatSession | null>("get_chat_session", { id }),
  create: (
    title: string,
    documentIds: number[],
    noteId: number | null,
  ) => invoke<number>("create_chat_session", { title, documentIds, noteId }),
  update: (id: number, title: string, documentIds: number[]) =>
    invoke<void>("update_chat_session", { id, title, documentIds }),
  remove: (id: number) => invoke<void>("delete_chat_session", { id }),
};

export const exportApi = {
  notesMd: (noteIds: number[], path: string) =>
    invoke<void>("export_notes_md", { noteIds, path }),
  chatMd: (sessionId: number, path: string) =>
    invoke<void>("export_chat_md", { sessionId, path }),
  chatPdf: (sessionId: number, path: string) =>
    invoke<void>("export_chat_pdf", { sessionId, path }),
  notesPdf: (noteIds: number[], path: string) =>
    invoke<void>("export_notes_pdf", { noteIds, path }),

  async saveNotesMd(noteIds: number[]): Promise<string | null> {
    const path = await pickSavePath(
      [`notes_${new Date().toISOString().slice(0, 10)}.md`],
      [{ name: "Markdown", extensions: ["md"] }],
    );
    if (!path) return null;
    await exportApi.notesMd(noteIds, path);
    return path;
  },

  async saveChatMd(sessionId: number, sessionTitle: string): Promise<string | null> {
    const path = await pickSavePath(
      [`chat_${sanitizeFilename(sessionTitle)}.md`],
      [{ name: "Markdown", extensions: ["md"] }],
    );
    if (!path) return null;
    await exportApi.chatMd(sessionId, path);
    return path;
  },

  async saveChatPdf(sessionId: number, sessionTitle: string): Promise<string | null> {
    const path = await pickSavePath(
      [`chat_${sanitizeFilename(sessionTitle)}.pdf`],
      [{ name: "PDF", extensions: ["pdf"] }],
    );
    if (!path) return null;
    await exportApi.chatPdf(sessionId, path);
    return path;
  },

  async saveNotesPdf(noteIds: number[]): Promise<string | null> {
    const path = await pickSavePath(
      [`notes_${new Date().toISOString().slice(0, 10)}.pdf`],
      [{ name: "PDF", extensions: ["pdf"] }],
    );
    if (!path) return null;
    await exportApi.notesPdf(noteIds, path);
    return path;
  },
};

export const settingsApi = {
  get: () => invoke<AiSettings>("get_settings"),
  save: (settings: SaveSettingsInput) =>
    invoke<void>("save_settings", { ...settings }),
  test: (
    provider: string,
    apiKey: string,
    baseUrl: string | null,
  ) => invoke<string>("test_provider_connection", { provider, apiKey, baseUrl }),
  ollamaModels: (baseUrl: string | null) =>
    invoke<string[]>("list_ollama_models", { baseUrl }),
};
