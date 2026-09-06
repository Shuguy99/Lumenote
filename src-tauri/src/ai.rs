use serde::{Deserialize, Serialize};
use serde_json::json;
use futures_util::StreamExt;

#[derive(Clone, Serialize, Deserialize, PartialEq)]
pub enum Provider {
    OpenAI,
    Anthropic,
    Ollama,
    Local,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct AiSettings {
    pub provider: String,
    pub api_key: String,
    pub model: String,
    pub base_url: Option<String>,
    pub temperature: f32,
    pub max_tokens: u32,
}

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            provider: "openai".to_string(),
            api_key: String::new(),
            model: "gpt-4o".to_string(),
            base_url: None,
            temperature: 0.7,
            max_tokens: 2000,
        }
    }
}

impl AiSettings {
    pub fn get_provider(&self) -> Provider {
        match self.provider.as_str() {
            "anthropic" => Provider::Anthropic,
            "ollama" => Provider::Ollama,
            "local" => Provider::Local,
            _ => Provider::OpenAI,
        }
    }
}

const LOCAL_BASE_URL: &str = "http://127.0.0.1:8080/v1";

fn local_effective_settings(settings: &AiSettings) -> AiSettings {
    let mut s = settings.clone();
    s.base_url = Some(LOCAL_BASE_URL.to_string());
    if s.api_key.is_empty() {
        s.api_key = "local".to_string();
    }
    s
}

fn default_headers(provider: &Provider, api_key: &str) -> Vec<(String, String)> {
    match provider {
        Provider::OpenAI | Provider::Ollama | Provider::Local => {
            let mut h = vec![("Content-Type".into(), "application/json".into())];
            if !api_key.is_empty() {
                h.push(("Authorization".into(), format!("Bearer {}", api_key)));
            }
            h
        }
        Provider::Anthropic => vec![
            ("Content-Type".into(), "application/json".into()),
            ("x-api-key".into(), api_key.to_string()),
            ("anthropic-version".into(), "2023-06-01".into()),
        ],
    }
}

fn documents_as_context(documents: &Vec<(String, String)>) -> String {
    if documents.is_empty() {
        return String::new();
    }
    let mut context = String::new();
    for (i, (title, content)) in documents.iter().enumerate() {
        let truncated: String = content.chars().take(12000).collect();
        context.push_str(&format!(
            "\n--- Document {}: {} ---\n{}\n",
            i + 1,
            title,
            truncated
        ));
    }
    context
}

fn build_system_prompt(context: &str) -> String {
    if context.trim().is_empty() {
        return "You are a helpful AI assistant in a notebook application. Answer concisely and accurately.".to_string();
    }

    let mut prompt = String::from(
        "You are an AI assistant inside a notebook application. \
         The user has uploaded the following documents. Answer questions BASED ONLY on these \
         documents. When you use information from a document, cite it at the end in parentheses \
         like [Doc: <document_title>]. If the answer isn't in the documents, say so clearly.\n\n\
         === DOCUMENTS ===\n",
    );

    prompt.push_str(context);
    prompt.push_str("\n=== END DOCUMENTS ===\n");

    prompt
}

pub async fn chat_completion(
    settings: &AiSettings,
    messages: &Vec<(String, String)>,
    documents: &Vec<(String, String)>,
) -> Result<String, String> {
    let context = documents_as_context(documents);
    run_chat_completion(settings, messages, &context).await
}

pub async fn chat_completion_with_context(
    settings: &AiSettings,
    messages: &Vec<(String, String)>,
    _documents: &Vec<(String, String)>,
    context: &str,
) -> Result<String, String> {
    run_chat_completion(settings, messages, context).await
}

async fn run_chat_completion(
    settings: &AiSettings,
    messages: &Vec<(String, String)>,
    context: &str,
) -> Result<String, String> {
    let provider = settings.get_provider();

    let mut api_messages: Vec<serde_json::Value> = Vec::new();
    api_messages.push(json!({
        "role": "system",
        "content": build_system_prompt(context)
    }));
    for (role, content) in messages {
        api_messages.push(json!({
            "role": role,
            "content": content
        }));
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    if provider == Provider::Local {
        let effective = local_effective_settings(settings);
        return openai_chat(&client, &effective, &mut api_messages).await;
    }

    match provider {
        Provider::OpenAI => {
            openai_chat(&client, settings, &mut api_messages).await
        }
        Provider::Anthropic => {
            anthropic_chat(&client, settings, &mut api_messages).await
        }
        Provider::Ollama => {
            ollama_chat(&client, settings, &mut api_messages).await
        }
        Provider::Local => unreachable!(),
    }
}

async fn openai_chat(
    client: &reqwest::Client,
    settings: &AiSettings,
    messages: &mut Vec<serde_json::Value>,
) -> Result<String, String> {
    let base_url = settings
        .base_url
        .clone()
        .unwrap_or_else(|| "https://api.openai.com/v1".to_string());
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let body = json!({
        "model": settings.model,
        "messages": messages,
        "temperature": settings.temperature,
        "max_tokens": settings.max_tokens
    });

    let resp = client
        .post(&url)
        .headers(build_headers(provider_headers(&Provider::OpenAI, &settings.api_key)))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("OpenAI request failed: {}", e))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    if !status.is_success() {
        return Err(format!("OpenAI API error ({}): {}", status, truncate(&text, 500)));
    }

    let parsed: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse OpenAI response: {}", e))?;

    parsed["choices"][0]["message"]["content"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "No content in OpenAI response".to_string())
}

async fn anthropic_chat(
    client: &reqwest::Client,
    settings: &AiSettings,
    messages: &mut Vec<serde_json::Value>,
) -> Result<String, String> {
    let base_url = settings
        .base_url
        .clone()
        .unwrap_or_else(|| "https://api.anthropic.com/v1".to_string());
    let url = format!("{}/messages", base_url.trim_end_matches('/'));

    let system = messages
        .iter()
        .find(|m| m["role"] == "system")
        .and_then(|m| m["content"].as_str())
        .unwrap_or("");

    let user_messages: Vec<serde_json::Value> = messages
        .iter()
        .filter(|m| m["role"] != "system")
        .cloned()
        .collect();

    let body = json!({
        "model": settings.model,
        "system": system,
        "messages": user_messages,
        "max_tokens": settings.max_tokens,
        "temperature": settings.temperature
    });

    let resp = client
        .post(&url)
        .headers(build_headers(provider_headers(&Provider::Anthropic, &settings.api_key)))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Anthropic request failed: {}", e))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    if !status.is_success() {
        return Err(format!("Anthropic API error ({}): {}", status, truncate(&text, 500)));
    }

    let parsed: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse Anthropic response: {}", e))?;

    parsed["content"][0]["text"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "No content in Anthropic response".to_string())
}

async fn ollama_chat(
    client: &reqwest::Client,
    settings: &AiSettings,
    messages: &mut Vec<serde_json::Value>,
) -> Result<String, String> {
    let base_url = settings
        .base_url
        .clone()
        .unwrap_or_else(|| "http://localhost:11434".to_string());
    let url = format!("{}/api/chat", base_url.trim_end_matches('/'));

    // Filter system message -> Ollama supports "system" role in messages
    let body = json!({
        "model": settings.model,
        "messages": messages,
        "stream": false,
        "options": {
            "temperature": settings.temperature,
            "num_predict": settings.max_tokens
        }
    });

    let resp = client
        .post(&url)
        .headers(build_headers(provider_headers(&Provider::Ollama, "")))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama request failed: {}", e))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    if !status.is_success() {
        return Err(format!("Ollama API error ({}): {}", status, truncate(&text, 500)));
    }

    let parsed: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

    parsed["message"]["content"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "No content in Ollama response".to_string())
}

fn provider_headers(provider: &Provider, api_key: &str) -> Vec<(String, String)> {
    default_headers(provider, api_key)
}

fn build_headers(headers: Vec<(String, String)>) -> reqwest::header::HeaderMap {
    let mut map = reqwest::header::HeaderMap::new();
    for (k, v) in headers {
        if let (Ok(k), Ok(v)) = (
            reqwest::header::HeaderName::from_bytes(k.as_bytes()),
            reqwest::header::HeaderValue::from_str(&v),
        ) {
            map.insert(k, v);
        }
    }
    map
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        let mut t: String = s.chars().take(max).collect();
        t.push_str("...");
        t
    }
}

pub async fn stream_chat_completion(
    settings: &AiSettings,
    messages: &Vec<(String, String)>,
    _documents: &Vec<(String, String)>,
    context: &str,
    channel: tauri::ipc::Channel<serde_json::Value>,
) -> Result<String, String> {
    let provider = settings.get_provider();

    let mut api_messages: Vec<serde_json::Value> = Vec::new();
    api_messages.push(json!({
        "role": "system",
        "content": build_system_prompt(context)
    }));
    for (role, content) in messages {
        api_messages.push(json!({
            "role": role,
            "content": content
        }));
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    if provider == Provider::Local {
        let effective = local_effective_settings(settings);
        return openai_stream(&client, &effective, &mut api_messages, &channel).await;
    }

    match provider {
        Provider::OpenAI => openai_stream(&client, settings, &mut api_messages, &channel).await,
        Provider::Anthropic => anthropic_stream(&client, settings, &mut api_messages, &channel).await,
        Provider::Ollama => ollama_stream(&client, settings, &mut api_messages, &channel).await,
        Provider::Local => unreachable!(),
    }
}

async fn openai_stream(
    client: &reqwest::Client,
    settings: &AiSettings,
    messages: &mut Vec<serde_json::Value>,
    channel: &tauri::ipc::Channel<serde_json::Value>,
) -> Result<String, String> {
    let base_url = settings
        .base_url
        .clone()
        .unwrap_or_else(|| "https://api.openai.com/v1".to_string());
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let body = json!({
        "model": settings.model,
        "messages": messages,
        "temperature": settings.temperature,
        "max_tokens": settings.max_tokens,
        "stream": true
    });

    let resp = client
        .post(&url)
        .headers(build_headers(provider_headers(&Provider::OpenAI, &settings.api_key)))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("OpenAI stream request failed: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp
            .text()
            .await
            .unwrap_or_default();
        let _ = channel.send(json!({"type": "error", "message": format!("OpenAI API error ({}): {}", status, truncate(&text, 500))}));
        return Err(format!("OpenAI API error ({}): {}", status, truncate(&text, 500)));
    }

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    let mut result = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream read error: {}", e))?;
        buf.push_str(&String::from_utf8_lossy(&chunk));

        loop {
            let pos = match buf.find('\n') {
                Some(p) => p,
                None => break,
            };
            let line = buf[..pos].trim().to_string();
            buf.drain(..pos + 1);

            if line.is_empty() || !line.starts_with("data:") {
                continue;
            }
            let data = line[5..].trim();
            if data == "[DONE]" {
                break;
            }
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                if let Some(delta) = parsed["choices"][0]["delta"]["content"].as_str() {
                    result.push_str(delta);
                    let _ = channel.send(json!({"type": "chunk", "text": delta}));
                }
            }
        }
    }

    let _ = channel.send(json!({"type": "done", "text": result}));
    Ok(result)
}

async fn anthropic_stream(
    client: &reqwest::Client,
    settings: &AiSettings,
    messages: &mut Vec<serde_json::Value>,
    channel: &tauri::ipc::Channel<serde_json::Value>,
) -> Result<String, String> {
    let base_url = settings
        .base_url
        .clone()
        .unwrap_or_else(|| "https://api.anthropic.com/v1".to_string());
    let url = format!("{}/messages", base_url.trim_end_matches('/'));

    let system = messages
        .iter()
        .find(|m| m["role"] == "system")
        .and_then(|m| m["content"].as_str())
        .unwrap_or("");

    let user_messages: Vec<serde_json::Value> = messages
        .iter()
        .filter(|m| m["role"] != "system")
        .cloned()
        .collect();

    let body = json!({
        "model": settings.model,
        "system": system,
        "messages": user_messages,
        "max_tokens": settings.max_tokens,
        "temperature": settings.temperature,
        "stream": true
    });

    let resp = client
        .post(&url)
        .headers(build_headers(provider_headers(&Provider::Anthropic, &settings.api_key)))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Anthropic stream request failed: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp
            .text()
            .await
            .unwrap_or_default();
        let _ = channel.send(json!({"type": "error", "message": format!("Anthropic API error ({}): {}", status, truncate(&text, 500))}));
        return Err(format!("Anthropic API error ({}): {}", status, truncate(&text, 500)));
    }

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    let mut result = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream read error: {}", e))?;
        buf.push_str(&String::from_utf8_lossy(&chunk));

        loop {
            let pos = match buf.find('\n') {
                Some(p) => p,
                None => break,
            };
            let line = buf[..pos].trim().to_string();
            buf.drain(..pos + 1);

            if line.is_empty() {
                continue;
            }
            if !line.starts_with("data:") || line == "data: [DONE]" {
                continue;
            }
            let data = line[5..].trim();
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                if parsed["type"] == "content_block_delta" {
                    if let Some(delta) = parsed["delta"]["text"].as_str() {
                        result.push_str(delta);
                        let _ = channel.send(json!({"type": "chunk", "text": delta}));
                    }
                }
            }
        }
    }

    let _ = channel.send(json!({"type": "done", "text": result}));
    Ok(result)
}

async fn ollama_stream(
    client: &reqwest::Client,
    settings: &AiSettings,
    messages: &mut Vec<serde_json::Value>,
    channel: &tauri::ipc::Channel<serde_json::Value>,
) -> Result<String, String> {
    let base_url = settings
        .base_url
        .clone()
        .unwrap_or_else(|| "http://localhost:11434".to_string());
    let url = format!("{}/api/chat", base_url.trim_end_matches('/'));

    let body = json!({
        "model": settings.model,
        "messages": messages,
        "stream": true,
        "options": {
            "temperature": settings.temperature,
            "num_predict": settings.max_tokens
        }
    });

    let resp = client
        .post(&url)
        .headers(build_headers(provider_headers(&Provider::Ollama, "")))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama stream request failed: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp
            .text()
            .await
            .unwrap_or_default();
        let _ = channel.send(json!({"type": "error", "message": format!("Ollama API error ({}): {}", status, truncate(&text, 500))}));
        return Err(format!("Ollama API error ({}): {}", status, truncate(&text, 500)));
    }

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    let mut result = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream read error: {}", e))?;
        buf.push_str(&String::from_utf8_lossy(&chunk));

        loop {
            let pos = match buf.find('\n') {
                Some(p) => p,
                None => break,
            };
            let line = buf[..pos].trim().to_string();
            buf.drain(..pos + 1);

            if line.is_empty() {
                continue;
            }
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&line) {
                if let Some(delta) = parsed["message"]["content"].as_str() {
                    result.push_str(delta);
                    let _ = channel.send(json!({"type": "chunk", "text": delta}));
                }
                if parsed.get("done").and_then(|d| d.as_bool()) == Some(true) {
                    break;
                }
            }
        }
    }

    let _ = channel.send(json!({"type": "done", "text": result}));
    Ok(result)
}

pub async fn test_provider_connection(
    provider: &str,
    api_key: &str,
    base_url: Option<String>,
) -> Result<String, String> {
    let provider_enum = match provider {
        "anthropic" => Provider::Anthropic,
        "ollama" => Provider::Ollama,
        "local" => Provider::Local,
        _ => Provider::OpenAI,
    };

    let (url, headers) = match provider_enum {
        Provider::Local => {
            let base = base_url
                .clone()
                .unwrap_or_else(|| "http://127.0.0.1:8080".to_string());
            let base = base.trim_end_matches('/');
            let base = base.strip_suffix("/v1").unwrap_or(base);
            (
                format!("{}/health", base),
                default_headers(&Provider::Local, "local"),
            )
        }
        Provider::OpenAI => {
            let base = base_url
                .clone()
                .unwrap_or_else(|| "https://api.openai.com/v1".to_string());
            (
                format!("{}/models", base.trim_end_matches('/')),
                default_headers(&Provider::OpenAI, api_key),
            )
        }
        Provider::Anthropic => {
            let base = base_url
                .clone()
                .unwrap_or_else(|| "https://api.anthropic.com/v1".to_string());
            (
                format!("{}/models", base.trim_end_matches('/')),
                default_headers(&Provider::Anthropic, api_key),
            )
        }
        Provider::Ollama => {
            let base = base_url
                .clone()
                .unwrap_or_else(|| "http://localhost:11434".to_string());
            (
                format!("{}/api/tags", base.trim_end_matches('/')),
                default_headers(&Provider::Ollama, ""),
            )
        }
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let headers = build_headers(headers);
    match client.get(&url).headers(headers).send().await {
        Ok(resp) => {
            let status = resp.status();
            if status.is_success() {
                Ok(format!("Соединение установлено ({})", status))
            } else {
                let text = resp.text().await.unwrap_or_default();
                Err(format!("HTTP {}: {}", status, truncate(&text, 300)))
            }
        }
        Err(e) => Err(format!("Ошибка запроса: {}", e)),
    }
}

pub async fn list_ollama_models(base_url: Option<String>) -> Result<Vec<String>, String> {
    let base = base_url.unwrap_or_else(|| "http://localhost:11434".to_string());
    let url = format!("{}/api/tags", base.trim_end_matches('/'));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Запрос к Ollama не удался: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", status, truncate(&text, 300)));
    }

    let text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    let parsed: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;

    Ok(parsed["models"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m["name"].as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default())
}

