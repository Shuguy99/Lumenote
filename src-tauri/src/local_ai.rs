use futures_util::StreamExt;
use serde::Serialize;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::{Command, CommandChild};

use crate::db;

pub const SERVER_PORT: u16 = 8080;
pub const SERVER_BASE: &str = "http://127.0.0.1:8080";

const ENGINE_FILENAME: &str = "llama-server.exe";
const MODEL_FILENAME: &str = "qwen2.5-1.5b-instruct-q4_k_m.gguf";
const MODEL_URL: &str = "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf";
const ENGINE_LATEST_API: &str =
    "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiStatus {
    pub state: String,
    pub phase: String,
    pub progress: Option<f64>,
    pub downloaded_mb: Option<u64>,
    pub total_mb: Option<u64>,
    pub error: Option<String>,
    pub model_path: Option<String>,
    pub port: u16,
}

pub struct LocalAiManager {
    pub child: Mutex<Option<CommandChild>>,
    pub status: Mutex<LocalAiStatus>,
}

fn idle_status() -> LocalAiStatus {
    LocalAiStatus {
        state: "unknown".to_string(),
        phase: "idle".to_string(),
        progress: None,
        downloaded_mb: None,
        total_mb: None,
        error: None,
        model_path: None,
        port: SERVER_PORT,
    }
}

impl Default for LocalAiManager {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
            status: Mutex::new(idle_status()),
        }
    }
}

pub fn engine_path() -> PathBuf {
    db::app_data_dir().join("engine").join(ENGINE_FILENAME)
}

pub fn model_path() -> PathBuf {
    db::app_data_dir().join("models").join(MODEL_FILENAME)
}

fn build_status(app: &AppHandle, status: LocalAiStatus) {
    if let Some(manager) = app.try_state::<LocalAiManager>() {
        *manager.status.lock().unwrap() = status.clone();
    }
    let _ = app.emit("local-ai-status", status);
}

fn current_status(app: &AppHandle) -> LocalAiStatus {
    match app.try_state::<LocalAiManager>() {
        Some(manager) => manager.status.lock().unwrap().clone(),
        None => idle_status(),
    }
}

pub async fn download_local_ai(app: AppHandle) -> Result<(), String> {
    if current_status(&app).state == "downloading" {
        return Ok(());
    }

    let engine_dir = db::app_data_dir().join("engine");
    let models_dir = db::app_data_dir().join("models");
    fs::create_dir_all(&engine_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&models_dir).map_err(|e| e.to_string())?;

    let mut status = current_status(&app);
    status.state = "downloading".to_string();
    status.error = None;
    build_status(&app, status);

    if !engine_path().exists() {
        let engine_url = match resolve_engine_url().await {
            Ok(url) => url,
            Err(e) => {
                set_error(&app, "engine", e.clone());
                return Err(format!("Не удалось определить ссылку на движок: {}", e));
            }
        };
        let zip_path = engine_dir.join("llama-server.zip");
        if zip_path.exists() {
            let _ = fs::remove_file(&zip_path);
        }
        if let Err(e) = download_file(&app, &engine_url, &zip_path, "engine", None).await {
            set_error(&app, "engine", e);
            return Err("Не удалось скачать движок llama-server".to_string());
        }
        if let Err(e) = extract_engine(&zip_path, &engine_path()) {
            let _ = fs::remove_file(&zip_path);
            set_error(&app, "engine", e);
            return Err(format!("Ошибка распаковки движка: {}", e));
        }
        let _ = fs::remove_file(&zip_path);
    }

    if !model_path().exists() {
        if let Err(e) = download_file(&app, MODEL_URL, &model_path(), "model", None).await {
            set_error(&app, "model", e);
            return Err("Не удалось скачать модель Qwen 1.5B".to_string());
        }
    }

    let mut status = current_status(&app);
    status.state = "ready".to_string();
    status.phase = "done".to_string();
    status.progress = Some(1.0);
    status.error = None;
    status.model_path = Some(model_path().to_string_lossy().into_owned());
    build_status(&app, status);

    Ok(())
}

fn set_error(app: &AppHandle, phase: &str, error: impl Into<String>) {
    let mut status = current_status(app);
    status.state = "download_error".to_string();
    status.phase = phase.to_string();
    status.error = Some(error.into());
    build_status(app, status);
}

async fn resolve_engine_url() -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get(ENGINE_LATEST_API)
        .header("User-Agent", "Lumenote/0.1")
        .send()
        .await
        .map_err(|e| format!("GitHub API request failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("GitHub API returned HTTP {}", resp.status()));
    }
    let json: serde_json::Value =
        resp.json().await.map_err(|e| format!("GitHub API parse failed: {}", e))?;
    let assets = json["assets"]
        .as_array()
        .ok_or_else(|| "GitHub API: no assets".to_string())?;
    for asset in assets {
        let name = asset["name"].as_str().unwrap_or("");
        if name.contains("bin-win-cpu-x64")
            && (name.ends_with(".zip") || name.ends_with(".tar.gz"))
        {
            let url = asset["browser_download_url"]
                .as_str()
                .ok_or_else(|| "GitHub API: missing download url".to_string())?;
            return Ok(url.to_string());
        }
    }
    Err("GitHub API: CPU release not found".to_string())
}

async fn download_file(
    app: &AppHandle,
    url: &str,
    dest: &Path,
    phase: &str,
    _expected_total: Option<u64>,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| format!("HTTP client: {}", e))?;
    let resp = client
        .get(url)
        .header("User-Agent", "Lumenote/0.1")
        .send()
        .await
        .map_err(|e| format!("Download request failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let total = resp.content_length();
    let mut file = File::create(dest).map_err(|e| e.to_string())?;
    let mut stream = resp.bytes_stream();
    let mut loaded: u64 = 0;
    let mut last_emit: f64 = 0.0;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream read error: {}", e))?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        loaded += chunk.len() as u64;
        if let Some(total) = total {
            let progress = loaded as f64 / total.max(1) as f64;
            if progress - last_emit >= 0.005 {
                last_emit = progress;
                let mut status = current_status(app);
                status.state = "downloading".to_string();
                status.phase = phase.to_string();
                status.progress = Some(progress);
                status.downloaded_mb = Some(loaded / (1024 * 1024));
                status.total_mb = Some(total / (1024 * 1024));
                status.error = None;
                build_status(app, status);
            }
        }
    }
    file.sync_all().map_err(|e| e.to_string())?;
    Ok(())
}

fn extract_engine(zip_path: &Path, dest: &Path) -> Result<(), String> {
    let file = File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        if name.ends_with("llama-server.exe") {
            let mut out = File::create(dest).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
    Err("llama-server.exe not found in archive".to_string())
}

pub async fn is_server_ready() -> bool {
    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
    else {
        return false;
    };
    client
        .get(format!("{SERVER_BASE}/health"))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

async fn wait_until_ready() -> bool {
    for _ in 0..360 {
        if is_server_ready().await {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    false
}

pub async fn start_local_server(app: AppHandle) -> Result<(), String> {
    if !engine_path().exists() || !model_path().exists() {
        return Err("Встроенная модель не скачана. Откройте Настройки и нажмите «Скачать встроенную модель»".to_string());
    }
    let manager = app.state::<LocalAiManager>();
    let has_child = manager.child.lock().unwrap().is_some();
    if has_child {
        return Err("Сервер уже запущен".to_string());
    }
    if is_server_ready().await {
        let mut status = current_status(&app);
        status.state = "running".to_string();
        status.error = None;
        build_status(&app, status);
        return Ok(());
    }

    let model = model_path();
    let args = vec![
        "--model".to_string(),
        model.to_string_lossy().into_owned(),
        "--host".to_string(),
        "127.0.0.1".to_string(),
        "--port".to_string(),
        SERVER_PORT.to_string(),
        "--ctx-size".to_string(),
        "8192".to_string(),
        "--n-gpu-layers".to_string(),
        "0".to_string(),
        "--api-key".to_string(),
        "local".to_string(),
    ];
    let child = Command::new(engine_path())
        .args(args)
        .spawn()
        .map_err(|e| format!("Не удалось запустить llama-server: {}", e))?;

    *manager.child.lock().unwrap() = Some(child);
    drop(manager);

    let mut status = current_status(&app);
    status.state = "starting".to_string();
    status.error = None;
    build_status(&app, status);

    let app2 = app.clone();
    tokio::spawn(async move {
        if wait_until_ready().await {
            let mut status = current_status(&app2);
            status.state = "running".to_string();
            status.error = None;
            build_status(&app2, status);
        } else {
            kill_engine(&app2);
            let mut status = current_status(&app2);
            status.state = "error".to_string();
            status.error = Some(
                "llama-server не смог загрузить модель (таймаут 3 мин). Попробуйте ещё раз.".to_string(),
            );
            build_status(&app2, status);
        }
    });

    Ok(())
}

fn kill_engine(app: &AppHandle) {
    if let Some(manager) = app.try_state::<LocalAiManager>() {
        if let Some(child) = manager.child.lock().unwrap().take() {
            let _ = child.kill();
        }
    }
}

pub fn kill_local_server(app: &AppHandle) {
    kill_engine(app);
    if app.try_state::<LocalAiManager>().is_some() {
        let mut status = current_status(app);
        status.state = "ready".to_string();
        status.error = None;
        build_status(app, status);
    }
}

pub async fn stop_local_server(app: AppHandle) -> Result<(), String> {
    kill_local_server(&app);
    Ok(())
}

pub async fn get_local_ai_status(app: AppHandle) -> LocalAiStatus {
    let mut status = current_status(&app);
    let engine_ok = engine_path().exists();
    let model_ok = model_path().exists();

    if !engine_ok || !model_ok {
        if status.state != "downloading" && status.state != "download_error" {
            status.state = "not_downloaded".to_string();
            status.phase = "idle".to_string();
            status.progress = None;
            status.error = None;
        }
        status.model_path = Some(model_path().to_string_lossy().into_owned());
        return status;
    }

    status.model_path = Some(model_path().to_string_lossy().into_owned());
    if is_server_ready().await {
        status.state = "running".to_string();
        status.error = None;
        return status;
    }

    let child_alive = match app.try_state::<LocalAiManager>() {
        Some(m) => m.child.lock().unwrap().is_some(),
        None => false,
    };
    if child_alive {
        status.state = "starting".to_string();
    } else {
        status.state = "ready".to_string();
        status.error = None;
    }
    status
}