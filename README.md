# Lumenote

Кросс-платформенное десктоп-приложение, аналогичное Google NotebookLM: загружайте документы, создавайте заметки и задавайте вопросы AI на основе ваших источников.

Построено на [Tauri 2](https://tauri.app) + [React 19](https://react.dev) + [TypeScript](https://www.typescriptlang.org/) и [SQLite](https://www.sqlite.org/).

## Возможности

- 📄 **Загрузка документов** — PDF, TXT, Markdown, JSON, CSV
- 📝 **Заметки** — Markdown-редактор с режимом предпросмотра
- 🤖 **AI-чат** — вопросы и ответы на основе загруженных документов (RAG) с цитированием источников
- 📋 **Автосаммари** — AI автоматически создаёт краткое содержание документов
- ⚙️ **Универсальные AI-провайдеры** — OpenAI, Anthropic, локальный Ollama

## Требования

- [Node.js](https://nodejs.org) 20+
- [Rust](https://rustup.rs) (stable)
- Системные зависимости Tauri: [Linux](https://tauri.app/start/prerequisites/#linux) / [Windows](https://tauri.app/start/prerequisites/#windows)

## Запуск в разработке

```bash
npm install
npm run tauri dev
```

## Сборка

```bash
npm run tauri build
```

Исполняемый файл и установочные пакеты (`deb`, `rpm`, `AppImage` для Linux; `msi`/`nsis` для Windows) появятся в `src-tauri/target/release/bundle/`.

## Настройка AI

В приложении откройте настройки (кнопка ⚙️ внизу слева), выберите провайдера:

| Провайдер | Как настроить |
|-----------|---------------|
| **OpenAI** | Введите API-ключ `sk-...`, модель `gpt-4o` |
| **Anthropic** | Введите API-ключ `sk-ant-...`, модель `claude-3-5-sonnet-latest` |
| **Ollama** | Локальные модели, API-ключ не нужен. Укажите `http://localhost:11434` |

Данные хранятся локально в `~/.local/share/ai-notebook/` (Linux) или `%APPDATA%/ai-notebook/` (Windows).

## Структура

```
src/                  # React фронтенд (компоненты, store, API)
src-tauri/
  src/
    main.rs           # точка входа
    lib.rs            # регистрация команд Tauri
    commands.rs       # IPC-команды
    db.rs             # SQLite (документы, заметки, чат, настройки)
    parser.rs         # парсинг PDF/TXT/MD/JSON/CSV
    ai.rs             # адаптеры OpenAI / Anthropic / Ollama
  capabilities/       # разрешения Tauri
  tauri.conf.json     # конфигурация окна и сборки
```

## Лицензия

MIT
