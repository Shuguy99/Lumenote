use printpdf::{BuiltinFont, IndirectFontRef, Mm, PdfDocument, PdfLayerReference};
use std::fs::File;
use std::io::BufWriter;
use std::path::Path;

const PAGE_W_MM: f64 = 210.0;
const PAGE_H_MM: f64 = 297.0;
const MARGIN_MM: f64 = 18.0;
const BODY_PT: f64 = 10.0;
const LINE_H_MM: f64 = 5.2;

struct FontPair {
    regular: IndirectFontRef,
    bold: IndirectFontRef,
}

fn font_candidates() -> Vec<&'static str> {
    vec![
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "C:\\Windows\\Fonts\\arial.ttf",
        "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
    ]
}

fn bold_candidates() -> Vec<&'static str> {
    vec![
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "C:\\Windows\\Fonts\\arialbd.ttf",
        "/Library/Fonts/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    ]
}

fn load_font(
    doc: &printpdf::PdfDocumentReference,
    paths: &[&'static str],
) -> Result<IndirectFontRef, String> {
    for p in paths {
        if let Ok(bytes) = std::fs::read(p) {
            let mut cursor = std::io::Cursor::new(bytes);
            if let Ok(f) = doc.add_external_font(&mut cursor) {
                return Ok(f);
            }
        }
    }
    doc.add_builtin_font(BuiltinFont::Helvetica)
        .map_err(|e| e.to_string())
}

struct Renderer<'a> {
    doc: &'a printpdf::PdfDocumentReference,
    page: printpdf::PdfPageIndex,
    layer: printpdf::PdfLayerIndex,
    fonts: &'a FontPair,
    y: f64,
    page_num: u32,
}

impl<'a> Renderer<'a> {
    fn new(
        doc: &'a printpdf::PdfDocumentReference,
        fonts: &'a FontPair,
    ) -> Self {
        let (page, layer) = doc.add_page(Mm(PAGE_W_MM as f32), Mm(PAGE_H_MM as f32), "page");
        Renderer {
            doc,
            page,
            layer,
            fonts,
            y: PAGE_H_MM - MARGIN_MM,
            page_num: 1,
        }
    }

    fn layer_ref(&self) -> PdfLayerReference {
        self.doc.get_page(self.page).get_layer(self.layer)
    }

    fn ensure_space(&mut self, mm: f64) {
        if self.y - mm < MARGIN_MM {
            let (page, layer) = self.doc.add_page(Mm(PAGE_W_MM as f32), Mm(PAGE_H_MM as f32), "page");
            self.page = page;
            self.layer = layer;
            self.y = PAGE_H_MM - MARGIN_MM;
            self.page_num += 1;
            self.draw_footer();
        }
    }

    fn draw_footer(&self) {
        let layer = self.layer_ref();
        layer.use_text(
            format!("— {} —", self.page_num),
            BODY_PT as f32 - 3.0,
            Mm(MARGIN_MM as f32),
            Mm((MARGIN_MM - 4.0) as f32),
            &self.fonts.regular,
        );
    }

    fn render_textblock(&mut self, text: &str, pt: f64, bold: bool, indent: f64) {
        let font = if bold { &self.fonts.bold } else { &self.fonts.regular };
        let avail_w = PAGE_W_MM - MARGIN_MM * 2.0 - indent;
        let char_w = pt * 0.5 / 2.8346;
        let max_chars = ((avail_w / char_w) as usize).max(20);

        for line in wrap_text(text, max_chars) {
            self.ensure_space(LINE_H_MM);
            let layer = self.layer_ref();
            layer.use_text(
                &line,
                pt as f32,
                Mm((MARGIN_MM + indent) as f32),
                Mm(self.y as f32),
                font,
            );
            self.y -= LINE_H_MM;
        }
        self.y -= LINE_H_MM * 0.4;
    }
}

fn wrap_text(text: &str, max_chars: usize) -> Vec<String> {
    let mut lines = Vec::new();
    let mut current = String::new();
    for word in text.split_whitespace() {
        if current.is_empty() {
            current.push_str(word);
        } else if current.len() + 1 + word.len() <= max_chars {
            current.push(' ');
            current.push_str(word);
        } else {
            lines.push(current.clone());
            current = word.to_string();
        }
    }
    if !current.is_empty() {
        lines.push(current);
    }
    lines
}

fn render_line(renderer: &mut Renderer, line: &str) {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        renderer.y -= LINE_H_MM * 0.6;
        return;
    }

    if trimmed.starts_with("```") {
        renderer.y -= LINE_H_MM * 0.3;
        return;
    }

    let (stripped, is_heading, heading_level, is_list) = if trimmed.starts_with("### ") {
        (&trimmed[4..], true, 3, false)
    } else if trimmed.starts_with("## ") {
        (&trimmed[3..], true, 2, false)
    } else if trimmed.starts_with("# ") {
        (&trimmed[2..], true, 1, false)
    } else if trimmed.starts_with("- ") || trimmed.starts_with("* ") {
        (&trimmed[2..], false, 0, true)
    } else {
        (trimmed, false, 0, false)
    };

    if is_heading {
        let pt = match heading_level {
            1 => 17.0,
            2 => 14.0,
            _ => 12.0,
        };
        renderer.ensure_space(LINE_H_MM * 2.0);
        renderer.y -= LINE_H_MM * 0.6;
        renderer.render_textblock(&strip_inline_md(stripped), pt, true, 0.0);
        renderer.y -= LINE_H_MM * 0.5;
    } else {
        let text = strip_inline_md(stripped);
        let indent = if is_list { 6.0 } else { 0.0 };
        let display = if is_list {
            format!("• {text}")
        } else {
            text.to_string()
        };
        renderer.render_textblock(&display, BODY_PT, false, indent);
    }
}

fn strip_inline_md(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match c {
            '*' | '_' if i + 1 < chars.len()
                && (chars[i + 1].is_alphanumeric() || is_punct(chars[i + 1])) =>
            {
                if i + 1 < chars.len() && chars[i + 1] == c {
                    i += 2;
                    while i + 1 < chars.len() && !(chars[i] == c && chars[i + 1] == c) {
                        i += 1;
                    }
                    i += 1;
                    continue;
                }
                i += 1;
                continue;
            }
            '`' => {
                i += 1;
                continue;
            }
            '[' => {
                if let Some(close) = text[i..].find(']') {
                    let inner = &text[i + 1..i + close];
                    out.push_str(inner);
                    i = i + close + 1;
                    if chars.get(i) == Some(&'(') {
                        if let Some(paren) = text[i..].find(')') {
                            i = i + paren + 1;
                        }
                    }
                    continue;
                }
                out.push(c);
            }
            _ => out.push(c),
        }
        i += 1;
    }
    out
}

fn is_punct(c: char) -> bool {
    matches!(c, '.' | ',' | '!' | '?' | ';' | ':' | ')' | '…')
}

pub fn export_pdf(markdown: &str, out_path: &str) -> Result<(), String> {
    let (doc, _, _) = PdfDocument::new(
        "Lumenote export",
        Mm(PAGE_W_MM as f32),
        Mm(PAGE_H_MM as f32),
        "Lumenote",
    );

    let regular = load_font(&doc, &font_candidates())?;
    let bold = load_font(&doc, &bold_candidates())?;
    let fonts = FontPair { regular, bold };

    let mut renderer = Renderer::new(&doc, &fonts);

    for line in markdown.lines() {
        render_line(&mut renderer, line);
    }

    let path = Path::new(out_path);
    let file = File::create(path).map_err(|e| e.to_string())?;
    doc.save(&mut BufWriter::new(file)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cyrillic_pdf_generated() {
        let md = "# Тест экспорта\n\n## Заголовок\n\nЭто **жирный** текст и *курсив* с кириллицей.\n\n- Пункт один\n- Пункт два\n\nРусский язык работает: бухгалтерия, объяснительная записка.\n\nКод: `fn main() {}` и [ссылка](https://example.com).\n";
        let path = std::env::temp_dir().join("lumenote_test_export.pdf");
        let p = path.to_str().unwrap();
        export_pdf(md, p).unwrap();
        let bytes = std::fs::read(p).unwrap();
        assert!(bytes.len() > 5000, "PDF too small: {}", bytes.len());
        assert!(bytes.starts_with(b"%PDF-"), "not a PDF header");
        std::fs::remove_file(p).ok();
    }
}