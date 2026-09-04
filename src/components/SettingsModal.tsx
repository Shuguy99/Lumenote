import { useEffect, useState } from "react";
import { settingsApi } from "../api";
import type { AiSettings } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
}

const PROVIDERS = [
  {
    id: "openai",
    name: "OpenAI",
    desc: "GPT-4o, GPT-4-turbo и другие модели",
    placeholder: "sk-...",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    desc: "Claude 3.5 Sonnet и другие",
    placeholder: "sk-ant-...",
  },
  {
    id: "ollama",
    name: "Ollama (локальный)",
    desc: "Локальные модели — без API-ключа",
    placeholder: "не требуется",
  },
];

export default function SettingsModal({ open, onClose }: Props) {
  const [settings, setSettings] = useState<AiSettings>({
    provider: "openai",
    api_key_masked: "",
    has_api_key: false,
    api_key: "",
    model: "gpt-4o",
    base_url: null,
    temperature: 0.7,
    max_tokens: 2000,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      settingsApi.get().then(setSettings).catch((e) => setError(String(e)));
      setSaved(false);
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const provider = PROVIDERS.find((p) => p.id === settings.provider) || PROVIDERS[0];

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const baseUrl = settings.base_url?.trim() || null;
      await settingsApi.save({
        provider: settings.provider,
        api_key: settings.api_key.trim(),
        model: settings.model.trim() || "gpt-4o",
        base_url: baseUrl,
        temperature: settings.temperature,
        max_tokens: Math.max(128, Math.min(16000, settings.max_tokens)),
      });
      setSaved(true);
      setTimeout(onClose, 800);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-[520px] max-w-[90vw] max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-800">Настройки AI</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Provider */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Провайдер AI
            </label>
            <div className="space-y-2">
              {PROVIDERS.map((p) => (
                <label
                  key={p.id}
                  className={`flex items-start p-3 rounded-lg border cursor-pointer transition-colors ${
                    settings.provider === p.id
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="provider"
                    checked={settings.provider === p.id}
                    onChange={() =>
                      setSettings((s) => ({
                        ...s,
                        provider: p.id,
                        model:
                          p.id === "anthropic"
                            ? "claude-3-5-sonnet-latest"
                            : p.id === "ollama"
                              ? "llama3"
                              : "gpt-4o",
                      }))
                    }
                    className="mt-1"
                  />
                  <div className="ml-3">
                    <p className="text-sm font-medium text-gray-800">{p.name}</p>
                    <p className="text-xs text-gray-500">{p.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* API Key (hidden for Ollama) */}
          {settings.provider !== "ollama" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                API ключ
              </label>
              <input
                type="password"
                value={settings.api_key}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, api_key: e.target.value }))
                }
                placeholder={settings.has_api_key ? "API ключ настроен — введи для замены" : provider.placeholder}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {settings.has_api_key && (
                <p className="text-xs text-gray-400 mt-1">
                  Сохранённый ключ: {settings.api_key_masked}
                </p>
              )}
            </div>
          )}

          {/* Model */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Модель
            </label>
            <input
              value={settings.model}
              onChange={(e) =>
                setSettings((s) => ({ ...s, model: e.target.value }))
              }
              placeholder="gpt-4o / claude-3-5-sonnet / llama3"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Base URL */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Base URL{" "}
              <span className="text-gray-400 font-normal">(опционально)</span>
            </label>
            <input
              value={settings.base_url || ""}
              onChange={(e) =>
                setSettings((s) => ({ ...s, base_url: e.target.value }))
              }
              placeholder="https://api.openai.com/v1 / http://localhost:11434"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Temperature and Max tokens */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Temperature: {settings.temperature.toFixed(1)}
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={settings.temperature}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    temperature: parseFloat(e.target.value),
                  }))
                }
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Max tokens
              </label>
              <input
                type="number"
                min="128"
                max="16000"
                step="128"
                value={settings.max_tokens}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    max_tokens: parseInt(e.target.value) || 2000,
                  }))
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {error && (
            <div className="px-3 py-2 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">
              {error}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
          <span className="text-sm text-emerald-600">{saved ? "Сохранено ✓" : ""}</span>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Отмена
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {saving ? "Сохранение..." : "Сохранить"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
