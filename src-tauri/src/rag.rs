const CHUNK_SIZE: usize = 1200;
const CHUNK_OVERLAP: usize = 200;
const MAX_CHUNKS_PER_DOC: usize = 50;
const MAX_TOTAL_CHUNKS: usize = 12;

pub fn split_into_chunks(content: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let chars: Vec<char> = content.chars().collect();
    if chars.is_empty() {
        return chunks;
    }

    let mut start = 0usize;
    let mut count = 0usize;
    while start < chars.len() && count < MAX_CHUNKS_PER_DOC {
        let mut end = (start + CHUNK_SIZE).min(chars.len());

        if end < chars.len() {
            let window = &chars[start..end];
            if let Some(last_newline) = window.iter().rposition(|&c| c == '\n') {
                if last_newline > CHUNK_SIZE / 3 {
                    end = start + last_newline;
                }
            } else if let Some(last_space) = window.iter().rposition(|&c| c == ' ') {
                if last_space > CHUNK_SIZE / 3 {
                    end = start + last_space;
                }
            }
        }

        let chunk: String = chars[start..end].iter().collect();
        let trimmed = chunk.trim();
        if !trimmed.is_empty() {
            chunks.push(trimmed.to_string());
        }

        if end >= chars.len() {
            break;
        }
        start = end.saturating_sub(CHUNK_OVERLAP);
        count += 1;
    }

    chunks
}

fn clean_query(q: &str) -> Vec<String> {
    q.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.chars().count() > 2)
        .map(|w| w.to_string())
        .collect()
}

fn score_chunk(chunk: &str, tokens: &[String]) -> usize {
    let lower = chunk.to_lowercase();
    tokens
        .iter()
        .map(|t| lower.matches(t).count())
        .sum()
}

pub fn select_relevant(
    chunks: &[(String, Vec<String>)],
    query: &str,
    max_tokens: usize,
) -> Vec<(usize, String)> {
    let tokens = clean_query(query);
    if tokens.is_empty() {
        return chunks
            .iter()
            .flat_map(|(_, doc_chunks)| {
                doc_chunks.iter().take(2).cloned().map(move |c| (0usize, c))
            })
            .take(MAX_TOTAL_CHUNKS)
            .collect();
    }

    let mut scored: Vec<(usize, usize, usize, String)> = Vec::new();
    for (doc_idx, (_, doc_chunks)) in chunks.iter().enumerate() {
        for (chunk_idx, chunk) in doc_chunks.iter().enumerate() {
            let score = score_chunk(chunk, &tokens);
            if score > 0 {
                scored.push((score, doc_idx, chunk_idx, chunk.clone()));
            }
        }
    }

    scored.sort_by(|a, b| b.0.cmp(&a.0));

    let mut result: Vec<(usize, String)> = Vec::new();
    let mut char_count = 0usize;
    let mut used_chunks = 0usize;

    for (score, doc_idx, _chunk_idx, chunk) in scored {
        let chunk_len = chunk.len();
        if char_count + chunk_len > max_tokens * 4 {
            continue;
        }
        if used_chunks >= MAX_TOTAL_CHUNKS {
            break;
        }
        if score == 0 {
            continue;
        }
        result.push((doc_idx, chunk));
        char_count += chunk_len;
        used_chunks += 1;
    }

    if result.is_empty() {
        for (doc_idx, (_, doc_chunks)) in chunks.iter().enumerate() {
            for chunk in doc_chunks.iter().take(2) {
                result.push((doc_idx, chunk.clone()));
                if result.len() >= MAX_TOTAL_CHUNKS {
                    break;
                }
            }
            if result.len() >= MAX_TOTAL_CHUNKS {
                break;
            }
        }
    }

    result
}

pub fn build_context(documents: &[(String, String)], query: &str, max_tokens: usize) -> String {
    let mut chunked: Vec<(String, Vec<String>)> = Vec::new();
    for (title, content) in documents {
        let chunks = split_into_chunks(content);
        chunked.push((title.clone(), chunks));
    }

    let selected = select_relevant(&chunked, query, max_tokens);

    let mut context = String::new();
    for (doc_idx, chunk) in selected {
        let title = &chunked[doc_idx].0;
        context.push_str(&format!("\n--- Из документа «{}» ---\n{}\n", title, chunk));
    }
    context
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunking_splits_by_newlines_and_respects_overlap() {
        let content = (1..=200)
            .map(|i| format!("Строка номер {i}"))
            .collect::<Vec<_>>()
            .join("\n");
        let chunks = split_into_chunks(&content);
        assert!(chunks.len() > 1);
        assert!(chunks.len() <= MAX_CHUNKS_PER_DOC);
        // Every chunk fits the budget.
        for c in &chunks {
            assert!(c.chars().count() <= CHUNK_SIZE);
        }
        // Overlap keeps continuity between consecutive chunks: the next chunk
        // must start with the tail of the previous one.
        if chunks.len() > 1 {
            let tail: String = chunks[0]
                .chars()
                .skip(chunks[0].chars().count().saturating_sub(CHUNK_OVERLAP))
                .collect();
            let head: String = chunks[1].chars().take(CHUNK_OVERLAP).collect();
            assert_eq!(tail, head);
        }
    }

    #[test]
    fn empty_content_yields_no_chunks() {
        assert!(split_into_chunks("").is_empty());
        assert!(split_into_chunks("   \n  ").is_empty());
    }

    #[test]
    fn selection_ranks_relevant_chunks_first() {
        let chunks: Vec<(String, Vec<String>)> = vec![(
            "Документ А".into(),
            vec![
                "Кошки любят веселье и забавы".into(),
                "Собаки охраняют дом".into(),
            ],
        )];
        let selected = select_relevant(&chunks, "кошки", 4000);
        assert!(!selected.is_empty());
        assert_eq!(selected[0].1, "Кошки любят веселье и забавы");
    }

    #[test]
    fn empty_tokens_fall_back_to_first_chunks() {
        let chunks: Vec<(String, Vec<String>)> = vec![(
            "Док".into(),
            vec!["один".into(), "два".into(), "три".into()],
        )];
        let selected = select_relevant(&chunks, "", 4000);
        assert_eq!(selected.len(), 2);
    }
}