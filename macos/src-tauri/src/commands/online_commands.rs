use rusqlite::params;
use serde::Deserialize;

use crate::db::DB;
use super::dict_commands::DictResult;

#[tauri::command]
pub async fn get_setting(key: String) -> Result<Option<String>, String> {
    let db = DB.get().unwrap().lock().unwrap();
    let val: Option<String> = db.query_row(
        "SELECT value FROM settings WHERE key=?1",
        params![key],
        |row| row.get(0),
    ).ok();
    Ok(val)
}

#[tauri::command]
pub async fn set_setting(key: String, value: String) -> Result<(), String> {
    let db = DB.get().unwrap().lock().unwrap();
    db.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![key, value],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

// Free Dictionary API response types
#[derive(Deserialize)]
struct ApiEntry {
    phonetic: Option<String>,
    meanings: Vec<Meaning>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Meaning {
    part_of_speech: String,
    definitions: Vec<Definition>,
    synonyms: Vec<String>,
}

#[derive(Deserialize)]
struct Definition {
    definition: String,
    example: Option<String>,
}

fn format_html(entries: &[ApiEntry], word: &str) -> String {
    let mut html = String::new();

    let phonetic = entries.iter().find_map(|e| e.phonetic.as_deref()).unwrap_or("");
    html.push_str(&format!(
        r#"<div class="od-header"><span class="od-hw">{word}</span>{ph}</div>"#,
        word = html_escape(word),
        ph = if phonetic.is_empty() {
            String::new()
        } else {
            format!(r#"<span class="od-pron">{}</span>"#, html_escape(phonetic))
        }
    ));

    for entry in entries {
        for meaning in &entry.meanings {
            html.push_str(&format!(
                r#"<div class="od-pos">{}</div><ol class="od-defs">"#,
                html_escape(&meaning.part_of_speech)
            ));
            for def in &meaning.definitions {
                html.push_str(&format!(
                    r#"<li><span class="od-def">{}</span>"#,
                    html_escape(&def.definition)
                ));
                if let Some(ex) = &def.example {
                    html.push_str(&format!(
                        r#"<div class="od-ex">{}</div>"#,
                        html_escape(ex)
                    ));
                }
                html.push_str("</li>");
            }
            html.push_str("</ol>");

            if !meaning.synonyms.is_empty() {
                let syns = meaning.synonyms.iter().take(6)
                    .map(|s| html_escape(s))
                    .collect::<Vec<_>>()
                    .join(", ");
                html.push_str(&format!(r#"<div class="od-syns"><b>Synonyms:</b> {syns}</div>"#));
            }
        }
    }

    let css = r#"<style>
.od-header { margin-bottom: 8px; }
.od-hw { font-size: 1.3em; font-weight: 700; }
.od-pron { margin-left: 8px; color: #6b7280; font-size: 0.9em; }
.od-pos { font-size: 0.8em; font-weight: 600; color: #9b5800; text-transform: uppercase;
          letter-spacing: 0.05em; margin: 12px 0 4px; }
.od-defs { margin: 0; padding-left: 1.4em; }
.od-defs li { margin-bottom: 6px; }
.od-def { }
.od-ex { color: #6b7280; font-style: italic; margin-top: 2px; font-size: 0.9em; }
.od-syns { font-size: 0.85em; color: #6b7280; margin-top: 4px; }
</style>"#;

    format!("{css}{html}")
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
     .replace('<', "&lt;")
     .replace('>', "&gt;")
     .replace('"', "&quot;")
}

#[tauri::command]
pub async fn ask_ai(word: String) -> Result<String, String> {
    let (base_url, api_key, model) = {
        let db = DB.get().unwrap().lock().unwrap();
        let get = |key: &str| -> Option<String> {
            db.query_row("SELECT value FROM settings WHERE key=?1", params![key], |r| r.get(0)).ok()
        };
        (
            get("llm_base_url").unwrap_or_else(|| "https://api.deepseek.com".into()),
            get("llm_api_key").unwrap_or_default(),
            get("llm_model").unwrap_or_else(|| "deepseek-v4-flash".into()),
        )
    };

    if api_key.is_empty() {
        return Err("请先在设置中填写 API Key".into());
    }

    let prompt = format!(
        "Explain the word \"{}\" for a language learner. Include:\n\
        - Core meaning and part of speech\n\
        - Key usage patterns with 2–3 natural examples\n\
        - Distinction from 1–2 commonly confused words (if relevant)\n\
        - A memorable tip or etymology (if interesting)\n\n\
        Format as clean HTML using <p>, <b>, <ol>, <li>, <i> tags. Keep it concise. \
        Respond in Chinese if the word is English.",
        word
    );

    let body = serde_json::json!({
        "model": model,
        "messages": [{ "role": "user", "content": prompt }],
        "max_tokens": 800,
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(format!("{}/chat/completions", base_url.trim_end_matches('/')))
        .bearer_auth(&api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("API error {status}: {text}"));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .to_string();

    // Strip markdown code fences if LLM wraps in ```html ... ```
    let html = content
        .trim()
        .trim_start_matches("```html")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim()
        .to_string();

    Ok(html)
}

#[tauri::command]
pub async fn lookup_online(word: String) -> Result<Option<DictResult>, String> {
    let url = format!(
        "https://api.dictionaryapi.dev/api/v2/entries/en/{}",
        urlencoding::encode(&word)
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;

    if resp.status() == 404 {
        return Ok(None);
    }
    if !resp.status().is_success() {
        return Err(format!("API error: {}", resp.status()));
    }

    let entries: Vec<ApiEntry> = resp.json().await.map_err(|e| e.to_string())?;
    if entries.is_empty() {
        return Ok(None);
    }

    let html = format_html(&entries, &word);
    Ok(Some(DictResult {
        dict_id: "online".to_string(),
        dict_name: "Free Dictionary".to_string(),
        word: word.clone(),
        definition: html,
        css: None,
    }))
}
