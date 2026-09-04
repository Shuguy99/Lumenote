use std::fs;
use std::path::Path;

pub fn parse_file(path: &Path) -> Result<String, String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "pdf" => parse_pdf(path),
        "txt" | "text" => parse_text(path),
        "md" | "markdown" => parse_text(path),
        "json" => parse_text(path),
        "csv" => parse_text(path),
        _ => Err(format!("Unsupported file type: .{}", ext)),
    }
}

fn parse_pdf(path: &Path) -> Result<String, String> {
    let data = fs::read(path).map_err(|e| format!("Failed to read PDF: {}", e))?;
    let text = pdf_extract::extract_text_from_mem(&data)
        .map_err(|e| format!("Failed to extract PDF text: {}", e))?;
    Ok(text)
}

fn parse_text(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("Failed to read file: {}", e))?;

    let (text, _, _) = encoding_rs::UTF_8.decode(&bytes);
    let text = String::from(text.trim());

    if text.is_empty() {
        Ok(String::new())
    } else {
        Ok(text)
    }
}

pub fn get_file_type(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("unknown")
        .to_lowercase()
}

pub fn get_file_size(path: &Path) -> Result<i64, String> {
    fs::metadata(path)
        .map(|m| m.len() as i64)
        .map_err(|e| format!("Failed to get file size: {}", e))
}
