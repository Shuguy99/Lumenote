# Lumenote

Кросс-платформенное десктоп-приложение, аналогичное Google NotebookLM: загружайте документы, создавайте заметки и задавайте вопросы AI на основе ваших источников.

Построено на [Tauri 2](https://tauri.app) + [React 19](https://react.dev) + [TypeScript](https://www.typescriptlang.org/) и [SQLite](https://www.sqlite.org/).

## Возможности

- 📄 **Загрузка источников** — PDF, TXT, Markdown, JSON, CSV, **DOCX**, **HTML**, а также добавление по **URL**
- 📝 **Заметки** — Markdown-редактор, привязка к фрагментам документов, цитируемые аннотации
- 🤖 **AI-чат (RAG)** — вопросы и ответы по загруженным документам с цитированием источников; множественные сессии с выбором источников; предложенные вопросы; чат по конкретной заметке
- 📋 **Автосаммари** — AI автоматически создаёт краткое содержание документов
- 💾 **Экспорт** — заметки и диалоги в Markdown и PDF
- ⚙️ **Универсальные AI-провайдеры** — OpenAI, Anthropic, локальный Ollama (с проверкой подключения и загрузкой списка моделей)

## Горячие клавиши

| Сочетание | Действие |
|-----------|----------|
| `Ctrl+N` / `Cmd+N` | Новая заметка |
| `Ctrl+/` / `Ctrl+K` | Фокус на поиск по источникам |
| `Enter` (в чате) | Отправить сообщение |
| `Shift+Enter` | Новая строка в чате |
| `Esc` | Закрыть настройки / снять подсветку цитаты |
| Двойной клик по сессии чата | Переименовать сессию |

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

> **Памятка для маломощных машин (≤8 ГБ RAM):** сборка в release может падать в SIGSEGV компилятора (LLVM) при оптимизации некоторых крейтов (например, `pdf-extract`). Помогает увеличенный стек потоков rustc:
>
> ```bash
> export RUST_MIN_STACK=67108864
> ```
>
> Крутых ресурсов также экономят `export CARGO_BUILD_JOBS=2`.

## Настройка AI

В приложении откройте настройки (кнопка ⚙️ внизу слева), выберите провайдера:

| Провайдер | Как настроить |
|-----------|---------------|
| **OpenAI** | Введите API-ключ `sk-...`, модель `gpt-4o` |
| **Anthropic** | Введите API-ключ `sk-ant-...`, модель `claude-3-5-sonnet-latest` |
| **Ollama** | Локальные модели, API-ключ не нужен. Укажите `http://localhost:11434` |

Кнопка **«Проверить подключение»** проверяет доступность провайдера с текущими параметрами; для Ollama доступна загрузка списка установленных моделей.

Данные хранятся локально в `~/.local/share/ai-notebook/` (Linux) или `%APPDATA%/ai-notebook/` (Windows).

## Структура

```
src/                  # React фронтенд (компоненты, store, API)
src-tauri/
  src/
    main.rs           # точка входа
    lib.rs            # регистрация команд Tauri
    commands.rs       # IPC-команды
    db.rs             # SQLite (документы, заметки, чат-сессии, настройки)
    parser.rs         # парсинг PDF/TXT/MD/JSON/CSV/DOCX/HTML/URL
    ai.rs             # адаптеры OpenAI / Anthropic / Ollama
    rag.rs            # полнотекстовый поиск по источникам
    export.rs         # генерация PDF (printpdf)
  capabilities/       # разрешения Tauri
  tauri.conf.json     # конфигурация окна и сборки
```

## Лицензия

MIT