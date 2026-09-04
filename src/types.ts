export interface Document {
  id: number;
  title: string;
  file_path: string;
  content: string;
  content_preview: string;
  file_type: string;
  size: number;
  summary: string | null;
  created_at: string;
}

export interface Note {
  id: number;
  title: string;
  content: string;
  document_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: number;
  role: string;
  content: string;
  created_at: string;
}

export interface AiSettings {
  provider: string;
  api_key_masked: string;
  has_api_key: boolean;
  api_key: string;
  model: string;
  base_url: string | null;
  temperature: number;
  max_tokens: number;
}

export interface SaveSettingsInput {
  provider: string;
  api_key: string;
  model: string;
  base_url?: string | null;
  temperature: number;
  max_tokens: number;
}

export interface SearchResult {
  document_id: number;
  title: string;
  snippet: string;
  match_index: number;
}

export interface ThemeSettings {
  theme: "light" | "dark";
}
