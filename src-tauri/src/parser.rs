use std::fs;
use std::io::Read;
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
        "md" | "markdown" => parse_markdown(path),
        "json" => parse_text(path),
        "csv" => parse_text(path),
        "docx" => parse_docx(path),
        "html" | "htm" => parse_html(&fs::read(path).map_err(|e| format!("Failed to read file: {}", e))?),
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

/// Handles Markdown: also preserves a plain-text render intent —
/// currently passes content through unchanged (it's already readable
/// and is handed to RAG as-is).
fn parse_markdown(path: &Path) -> Result<String, String> {
    parse_text(path)
}

/// Extracts text from a .docx file (the main document.xml inside the zip).
fn parse_docx(path: &Path) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|e| format!("Failed to open DOCX: {}", e))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("Failed to open DOCX archive: {}", e))?;

    let mut doc_file = archive
        .by_name("word/document.xml")
        .map_err(|e| format!("word/document.xml not found: {}", e))?;

    let mut xml = String::new();
    doc_file
        .read_to_string(&mut xml)
        .map_err(|e| format!("Failed to read DOCX XML: {}", e))?;

    let mut out = String::new();
    let mut reader = quick_xml::Reader::from_str(&xml);
    let mut buf = Vec::new();
    let mut in_t = false;
    let mut current_para = String::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(quick_xml::events::Event::Start(e)) => {
                if e.name().as_ref() == "w:t" {
                    in_t = true;
                } else if e.name().as_ref() == "w:tab" {
                    current_para.push(' ');
                }
            }
            Ok(quick_xml::events::Event::Text(t)) => {
                if in_t {
                    current_para.push_str(t.as_ref());
                }
            }
            Ok(quick_xml::events::Event::GeneralRef(r)) => {
                if in_t {
                    let d: &str = &r;
                    if let Ok(Some(ch)) = r.resolve_char_ref() {
                        current_para.push(ch);
                    } else {
                        match d {
                            "amp" => current_para.push('&'),
                            "lt" => current_para.push('<'),
                            "gt" => current_para.push('>'),
                            "quot" => current_para.push('"'),
                            "apos" => current_para.push('\''),
                            _ => {}
                        }
                    }
                }
            }
            Ok(quick_xml::events::Event::End(e)) => {
                if e.name().as_ref() == "w:p" || e.name().as_ref() == "w:tr" {
                    let line = current_para.trim_end();
                    if !line.is_empty() {
                        out.push_str(line);
                        out.push('\n');
                    }
                    current_para.clear();
                    in_t = false;
                }
            }
            Ok(quick_xml::events::Event::Eof) => break,
            Err(e) => return Err(format!("Failed to parse DOCX XML: {}", e)),
            _ => {}
        }
        buf.clear();
    }

    Ok(out.trim().to_string())
}

/// Extracts a readable text representation from raw HTML bytes.
pub fn parse_html(bytes: &[u8]) -> Result<String, String> {
    let (text, _, _) = encoding_rs::UTF_8.decode(bytes);
    let rendered = html2text::from_read(&text.as_bytes().to_vec()[..], 120)
        .map_err(|e| format!("Failed to parse HTML: {}", e))?;
    let rendered = rendered.trim().to_string();
    if rendered.is_empty() {
        Ok(String::new())
    } else {
        Ok(rendered)
    }
}

/// Extracts the <title> from HTML bytes.
pub fn html_title(bytes: &[u8]) -> String {
    let (html, _, _) = encoding_rs::UTF_8.decode(bytes);
    use std::sync::OnceLock;
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| {
        regex::Regex::new(r"(?is)<title[^>]*>(.*?)</title>").expect("valid title regex")
    });
    RE.get().unwrap()
        .captures(&html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().trim().to_string())
        .unwrap_or_default()
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn docx_basic_extraction() {
        let mut buf = Vec::new();
        {
            let mut ar = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts = zip::write::SimpleFileOptions::default();
            ar.start_file("word/document.xml", opts).unwrap();
            ar.write_all(
                b"<?xml version=\"1.0\"?><w:document xmlns:w=\"w\"><w:body>\
                  <w:p><w:r><w:t>First &amp; second line</w:t></w:r></w:p>\
                  <w:p><w:r><w:t>Hello</w:t></w:r></w:p>\
                  </w:body></w:document>",
            )
            .unwrap();
            ar.finish().unwrap();
        }
        let tmp = std::env::temp_dir().join("parser_test_docx.docx");
        fs::write(&tmp, &buf).unwrap();
        let text = parse_docx(&tmp).unwrap();
        assert!(text.contains("First & second line"));
        assert!(text.contains("Hello"));
        let _ = fs::remove_file(&tmp);
    }

    #[test]
    fn html_title_extraction() {
        let html = b"<html><head><title>  My Page  </title></head><body></body></html>";
        assert_eq!(html_title(html), "My Page");
    }

    #[test]
    fn html_text_extraction() {
        let html = b"<html><body><h1>Header</h1><p>Hello <b>World</b></p></body></html>";
        let text = parse_html(html).unwrap();
        assert!(text.contains("Header"));
        assert!(text.contains("World"));
    }
}