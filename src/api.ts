import { invoke, Channel } from "@tauri-apps/api/core";
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

export const documentsApi = {
  load: () => invoke<Document[]>("load_documents"),
  add: (path: string) => invoke<Document>("add_document", { path }),
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

export const settingsApi = {
  get: () => invoke<AiSettings>("get_settings"),
  save: (settings: SaveSettingsInput) =>
    invoke<void>("save_settings", { ...settings }),
};
