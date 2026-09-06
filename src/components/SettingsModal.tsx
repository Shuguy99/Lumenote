import { useEffect, useState } from "react";
import { localAiApi, settingsApi } from "../api";
import type { AiSettings, LocalAiStatus } from "../types";

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
  {
    id: "local",
    name: "Встроенная (Qwen 1.5B)",
    desc: "Локально на этом ПК — без интернета и API-ключа",
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
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState<LocalAiStatus | null>(null);
  const [localBusy, setLocalBusy] = useState(false);

  useEffect(() => {
    if (open) {
      settingsApi.get().then(setSettings).catch((e) => setError(String(e)));
      setSaved(false);
      setError(null);
      setTestResult(null);
      setModels([]);
      setModelsError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let unlisten: (() => void) | undefined;
    localAiApi.onStatus(setLocalStatus).then((fn) => {
      unlisten = fn;
    });
    localAiApi
      .status()
      .then(setLocalStatus)
      .catch(() => {
        /* локальный AI недоступен */
      });
    return () => {
      unlisten?.();
    };
  }, [open]);

  const handleDownloadLocal = async () => {
    setLocalBusy(true);
    setError(null);
    try {
      await localAiApi.download();
    } catch (e) {
      setError(String(e));
    } finally {
      setLocalBusy(false);
    }
  };

  const handleStartLocal = async () => {
    setLocalBusy(true);
    setError(null);
    try {
      await localAiApi.start();
    } catch (e) {
      setError(String(e));
    } finally {
      setLocalBusy(false);
    }
  };

  const handleStopLocal = async () => {
    try {
      await localAiApi.stop();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await settingsApi.test(
        settings.provider,
        settings.provider === "local" ? "local" : settings.api_key.trim(),
        settings.provider === "local" ? null : settings.base_url?.trim() || null,
      );
      setTestResult({ ok: true, text: res });
    } catch (e) {
      setTestResult({ ok: false, text: String(e) });
    } finally {
      setTesting(false);
    }
  };

  const handleLoadModels = async () => {
    setLoadingModels(true);
    setModelsError(null);
    setModels([]);
    try {
      const list = await settingsApi.ollamaModels(
        settings.base_url?.trim() || null,
      );
      setModels(list);
    } catch (e) {
      setModelsError(String(e));
    } finally {
      setLoadingModels(false);
    }
  };

  if (!open) return null;

  const provider = PROVIDERS.find((p) => p.id === settings.provider) || PROVIDERS[0];

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const baseUrl = settings.base_url?.trim() || null;
      if (settings.provider === "local") {
        await settingsApi.save({
          provider: "local",
          api_key: "",
          model: "qwen2.5-1.5b-instruct",
          base_url: "http://127.0.0.1:8080/v1",
          temperature: settings.temperature,
          max_tokens: Math.max(128, Math.min(16000, settings.max_tokens)),
        });
      } else {
        await settingsApi.save({
          provider: settings.provider,
          api_key: settings.api_key.trim(),
          model: settings.model.trim() || "gpt-4o",
          base_url: baseUrl,
          temperature: settings.temperature,
          max_tokens: Math.max(128, Math.min(16000, settings.max_tokens)),
        });
      }
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
          {/* Встроенная модель */}
          <div className="p-4 rounded-xl border border-gray-200 bg-gray-50">
            <p className="text-sm font-semibold text-gray-800">
              Встроенная модель (локально)
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Qwen2.5 1.5B, ~1.3 ГБ. Скачивается один раз и работает без
              интернета и API-ключа.
            </p>

            {localStatus?.state === "downloading" && (
              <div className="mt-3">
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 rounded-full transition-all"
                    style={{
                      width: `${Math.round(
                        (localStatus.progress ?? 0) * 100,
                      )}%`,
                    }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {localStatus.phase === "engine"
                    ? "Скачивание движка…"
                    : "Скачивание модели…"}{" "}
                  {localStatus.downloaded_mb != null &&
                    localStatus.total_mb != null &&
                    `${localStatus.downloaded_mb} / ${localStatus.total_mb} МБ`}
                </p>
              </div>
            )}

            {!localStatus ||
              ((localStatus.state === "unknown" ||
                localStatus.state === "not_downloaded" ||
                localStatus.state === "download_error") && (
                <div className="mt-3">
                  <button
                    onClick={handleDownloadLocal}
                    disabled={localBusy}
                    className="text-xs text-white bg-blue-600 rounded-lg px-3 py-1.5 hover:bg-blue-700 transition-colors disabled:opacity-50"
                  >
                    {localBusy
                      ? "Загрузка…"
                      : "Скачать встроенную модель (~1.3 ГБ)"}
                  </button>
                  {localStatus?.state === "download_error" &&
                    localStatus.error && (
                      <p className="text-xs text-red-600 mt-1.5">
                        {localStatus.error}
                      </p>
                    )}
                </div>
              ))}

            {(localStatus?.state === "ready" ||
              localStatus?.state === "stopped") && (
              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={handleStartLocal}
                  disabled={localBusy}
                  className="text-xs text-white bg-blue-600 rounded-lg px-3 py-1.5 hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {localBusy ? "Запуск…" : "Запустить"}
                </button>
              </div>
            )}

            {localStatus?.state === "starting" && (
              <p className="mt-3 text-xs text-blue-600 flex items-center gap-2">
                <span className="inline-block w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                Запускается… загрузка модели в память
              </p>
            )}

            {localStatus?.state === "running" && (
              <div className="mt-3 flex items-center gap-2.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-xs text-emerald-700">
                  Сервер работает (http://127.0.0.1:8080)
                </span>
                <button
                  onClick={handleStopLocal}
                  className="text-xs text-slate-700 border border-gray-300 rounded-lg px-2.5 py-1 hover:bg-gray-100 transition-colors"
                >
                  Остановить
                </button>
              </div>
            )}

            {localStatus?.state === "error" && (
              <div className="mt-3">
                <p className="text-xs text-red-600">{localStatus.error}</p>
                <button
                  onClick={handleStartLocal}
                  disabled={localBusy}
                  className="mt-2 text-xs text-white bg-blue-600 rounded-lg px-3 py-1.5 hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {localBusy ? "Запуск…" : "Повторить запуск"}
                </button>
              </div>
            )}
          </div>

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
                              : p.id === "local"
                                ? "qwen2.5-1.5b-instruct"
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

          {/* API Key (hidden for Ollama and built-in) */}
          {settings.provider !== "ollama" && settings.provider !== "local" && (
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
            {settings.provider === "local" ? (
              <p className="text-sm text-gray-500">
                qwen2.5-1.5b-instruct{" "}
                <span className="text-xs text-gray-400">
                  (загружается встроенным движком)
                </span>
              </p>
            ) : (
              <input
                value={settings.model}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, model: e.target.value }))
                }
                placeholder="gpt-4o / claude-3-5-sonnet / llama3"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            )}
          </div>

          {/* Ollama models loader */}
          {settings.provider === "ollama" && (
            <div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleLoadModels}
                  disabled={loadingModels}
                  className="text-xs text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors disabled:opacity-50"
                >
                  {loadingModels
                    ? "Загрузка моделей..."
                    : "Получить список моделей Ollama"}
                </button>
              </div>
              {modelsError && (
                <p className="text-xs text-red-600 mt-1.5">{modelsError}</p>
              )}
              {models.length > 0 && (
                <select
                  value={settings.model}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, model: e.target.value }))
                  }
                  className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value={settings.model} disabled>
                    Выберите модель...
                  </option>
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Base URL */}
          {settings.provider !== "local" && (
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
          )}

          {/* Connection test */}
          <div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleTest}
                disabled={testing}
                className="text-xs text-slate-700 border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                {testing ? "Проверка..." : "Проверить подключение"}
              </button>
              {testResult && (
                <span
                  className={`text-xs ${
                    testResult.ok
                      ? "text-emerald-600"
                      : "text-red-600"
                  }`}
                >
                  {testResult.text}
                </span>
              )}
            </div>
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
