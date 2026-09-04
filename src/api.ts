import { invoke } from "@tauri-apps/api/core";
import type {
  AiSettings,
  ChatMessage,
  Document,
  Note,
  SaveSettingsInput,
} from "./types";

export const documentsApi = {
  load: () => invoke<Document[]>("load_documents"),
  add: (path: string) => invoke<Document>("add_document", { path }),
  get: (id: number) => invoke<Document | null>("get_document", { id }),
  remove: (id: number) => invoke<void>("delete_document", { id }),
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
};

export const settingsApi = {
  get: () => invoke<AiSettings>("get_settings"),
  save: (settings: SaveSettingsInput) =>
    invoke<void>("save_settings", { ...settings }),
};
