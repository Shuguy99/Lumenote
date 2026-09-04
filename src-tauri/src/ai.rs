use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Clone, Serialize, Deserialize, PartialEq)]
pub enum Provider {
    OpenAI,
    Anthropic,
    Ollama,
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
            _ => Provider::OpenAI,
        }
    }
}

fn default_headers(provider: &Provider, api_key: &str) -> Vec<(String, String)> {
    match provider {
        Provider::OpenAI | Provider::Ollama => {
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

fn build_system_prompt(documents: &Vec<(String, String)>) -> String {
    if documents.is_empty() {
        return "You are a helpful AI assistant in a notebook application. Answer concisely and accurately.".to_string();
    }

    let mut prompt = String::from(
        "You are an AI assistant inside a notebook application. \
         The user has uploaded the following documents. Answer questions BASED ONLY on these \
         documents. When you use information from a document, cite it at the end in parentheses \
         like [Doc: <document_title>]. If the answer isn't in the documents, say so clearly.\n\n\
         === DOCUMENTS ===\n",
    );

    for (i, (title, content)) in documents.iter().enumerate() {
        let truncated: String = content.chars().take(12000).collect();
        prompt.push_str(&format!(
            "\n--- Document {}: {} ---\n{}\n",
            i + 1,
            title,
            truncated
        ));
    }

    prompt.push_str("\n=== END DOCUMENTS ===\n");

    prompt
}

pub async fn chat_completion(
    settings: &AiSettings,
    messages: &Vec<(String, String)>,
    documents: &Vec<(String, String)>,
) -> Result<String, String> {
    let provider = settings.get_provider();

    let mut api_messages: Vec<serde_json::Value> = Vec::new();
    api_messages.push(json!({
        "role": "system",
        "content": build_system_prompt(documents)
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
