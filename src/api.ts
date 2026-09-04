import { invoke, Channel } from "@tauri-apps/api/core";
import type {
  AiSettings,
  ChatMessage,
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
  create: (title: string, content: string, documentId: number | null) =>
    invoke<number>("create_note", { title, content, documentId }),
  update: (
    id: number,
    title: string,
    content: string,
    documentId: number | null,
  ) => invoke<void>("edit_note", { id, title, content, documentId }),
  remove: (id: number) => invoke<void>("delete_note", { id }),
};

export const chatApi = {
  history: () => invoke<ChatMessage[]>("get_chat_history"),
  clear: () => invoke<void>("clear_chat_history"),
  send: (message: string, documentIds: number[]) =>
    invoke<string>("send_chat_message", { message, documentIds }),
  stream: (
    message: string,
    documentIds: number[],
    onEvent: (event: StreamEvent) => void,
  ): Promise<void> => {
    const channel = new Channel<StreamEvent>();
    channel.onmessage = onEvent;
    return invoke<void>("stream_chat_message", {
      message,
      documentIds,
      onEvent: channel,
    });
  },
};

export const settingsApi = {
  get: () => invoke<AiSettings>("get_settings"),
  save: (settings: SaveSettingsInput) =>
    invoke<void>("save_settings", { ...settings }),
};
