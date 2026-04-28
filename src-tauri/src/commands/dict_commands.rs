use crate::db::DB;
use crate::dict::{load_dict, unload_dict, DictIndex, DICT_REGISTRY};
use anyhow::Result;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

static DICTS_READY: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub async fn are_dicts_ready() -> bool {
    DICTS_READY.load(Ordering::Relaxed)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Dictionary {
    pub id: String,
    pub name: String,
    pub file_path: String,
    pub enabled: bool,
    pub sort_order: i64,
    pub added_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DictResult {
    pub dict_id: String,
    pub dict_name: String,
    pub word: String,
    pub definition: String,
    pub css: Option<String>,
}

#[tauri::command]
pub async fn import_dictionary(dir_path: String) -> Result<Dictionary, String> {
    import_dict_inner(&dir_path).map_err(|e| format!("{:#}", e))
}

/// Debug audio pipeline: shows MDD load status, key matches, and player availability.
#[tauri::command]
pub async fn debug_audio(word: String) -> Result<String, String> {
    let mut out = String::new();

    // Check player availability
    let afplay_ok = std::process::Command::new("which").arg("afplay").output().map(|o| o.status.success()).unwrap_or(false);
    let ffplay_ok = std::process::Command::new("which").arg("ffplay").output().map(|o| o.status.success()).unwrap_or(false);
    out.push_str(&format!("Players: afplay={} ffplay={}\n\n", afplay_ok, ffplay_ok));

    let registry = match DICT_REGISTRY.get() {
        Some(r) => r.read().unwrap(),
        None => { out.push_str("ERROR: registry not init\n"); return Ok(out); }
    };

    out.push_str(&format!("Loaded dicts: {}\n", registry.len()));
    for (id, dict) in registry.iter() {
        match dict.mdd.as_ref() {
            None => out.push_str(&format!("  [{id}] mdd=None\n")),
            Some(mdd) => {
                let key_count = mdd.keys().count();
                out.push_str(&format!("  [{id}] mdd=Some ({key_count} keys)\n"));

                // Call the real lookup_audio_for_word (includes fallback scan)
                match mdd.lookup_audio_for_word(&word) {
                    Ok(Some((data, ext))) => {
                        out.push_str(&format!("  lookup_audio_for_word => FOUND ({} bytes, .{})\n", data.len(), ext));
                        // Try writing temp file and spawning afplay
                        let tmp = std::env::temp_dir().join(format!("glean_debug_audio.{ext}"));
                        match std::fs::write(&tmp, &data) {
                            Err(e) => out.push_str(&format!("  write temp file FAILED: {e}\n")),
                            Ok(_) => {
                                out.push_str(&format!("  wrote {} bytes to {:?}\n", data.len(), tmp));
                                // Check magic bytes
                                let magic = &data[..data.len().min(4)];
                                out.push_str(&format!("  magic bytes: {:02x?}\n", magic));
                                let spawn_ok = std::process::Command::new("afplay")
                                    .arg(&tmp)
                                    .spawn()
                                    .is_ok();
                                out.push_str(&format!("  afplay spawn: {}\n", spawn_ok));
                            }
                        }
                    }
                    Ok(None) => out.push_str("  lookup_audio_for_word => None (no match)\n"),
                    Err(e) => out.push_str(&format!("  lookup_audio_for_word => Error: {e}\n")),
                }

                // Show up to 6 keys containing the word (for reference)
                let w = word.to_lowercase();
                let sample: Vec<_> = mdd.keys()
                    .filter(|k| k.contains(w.as_str()))
                    .take(6)
                    .collect();
                out.push_str(&format!("  Sample keys containing '{w}': {:?}\n", sample));
            }
        }
    }
    Ok(out)
}

/// Debug: dump the loaded CSS for each dictionary (first `chars` characters each).
#[tauri::command]
pub async fn debug_dict_css(chars: usize) -> Result<Vec<String>, String> {
    let registry = DICT_REGISTRY
        .get()
        .ok_or("registry not init")?
        .read()
        .unwrap();
    let mut results = Vec::new();
    for (id, dict) in registry.iter() {
        match dict.css.as_ref() {
            Some(css) => {
                let snippet = &css[..css.len().min(chars)];
                results.push(format!("[{}] ({} bytes total)\n{}", id, css.len(), snippet));
            }
            None => results.push(format!("[{}] NO CSS", id)),
        }
    }
    Ok(results)
}

/// Returns a map of dict_id → data: URL for dicts that have an icon file in their directory.
#[tauri::command]
pub async fn get_dict_icons() -> Result<std::collections::HashMap<String, String>, String> {
    use std::path::Path;

    let registry = DICT_REGISTRY
        .get()
        .ok_or("registry not init")?
        .read()
        .unwrap();

    let mut icons = std::collections::HashMap::new();
    for (id, dict) in registry.iter() {
        let dict_dir = Path::new(&dict.file_path).parent();
        if let Some(dir) = dict_dir {
            if let Some(data_url) = find_icon_in_dir(dir) {
                icons.insert(id.clone(), data_url);
            }
        }
    }
    Ok(icons)
}

fn mime_for_ext(ext: &str) -> &'static str {
    match ext {
        "ico" => "image/x-icon",
        "png" => "image/png",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "jpg" | "jpeg" => "image/jpeg",
        _ => "image/png",
    }
}

fn find_icon_in_dir(dir: &std::path::Path) -> Option<String> {
    use base64::Engine as _;

    // Priority: named icons first, then any image file
    let priority_names = ["favicon.ico", "favicon.png", "icon.ico", "icon.png",
                          "logo.ico", "logo.png", "logo.gif"];
    for name in &priority_names {
        let path = dir.join(name);
        if path.exists() {
            if let Ok(data) = std::fs::read(&path) {
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("png").to_lowercase();
                let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
                return Some(format!("data:{};base64,{}", mime_for_ext(&ext), b64));
            }
        }
    }

    // Any image file in the directory
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let p = entry.path();
        if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
            if matches!(ext.to_lowercase().as_str(), "ico" | "png" | "gif" | "jpg" | "jpeg") {
                if let Ok(data) = std::fs::read(&p) {
                    let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
                    return Some(format!("data:{};base64,{}", mime_for_ext(&ext.to_lowercase()), b64));
                }
            }
        }
    }
    None
}

/// Debug: list the first N MDD keys containing `filter` substring across all loaded dicts.
#[tauri::command]
pub async fn debug_mdd_keys(filter: String, limit: usize) -> Result<Vec<String>, String> {
    let registry = DICT_REGISTRY
        .get()
        .ok_or("registry not init")?
        .read()
        .unwrap();
    let mut results = Vec::new();
    for dict in registry.values() {
        if let Some(mdd) = dict.mdd.as_ref() {
            for key in mdd.keys() {
                if filter.is_empty() || key.contains(&filter.to_lowercase()) {
                    results.push(key.to_string());
                    if results.len() >= limit { break; }
                }
            }
        }
        if results.len() >= limit { break; }
    }
    results.sort();
    Ok(results)
}

/// Debug: try multiple decryption strategies on the key block info
#[tauri::command]
pub async fn debug_mdx_header(file_path: String) -> Result<String, String> {
    use std::io::Read;
    use ripemd::{Ripemd128, Digest};

    let mut f = std::fs::File::open(&file_path).map_err(|e| e.to_string())?;
    let mut buf4 = [0u8; 4];
    f.read_exact(&mut buf4).map_err(|e| e.to_string())?;
    let header_len = u32::from_be_bytes(buf4) as usize;

    let mut header_bytes = vec![0u8; header_len.min(4096)];
    f.read_exact(&mut header_bytes).map_err(|e| e.to_string())?;
    let mut chk4 = [0u8; 4];
    f.read_exact(&mut chk4).map_err(|e| e.to_string())?;

    let mut kb_header = [0u8; 44];
    f.read_exact(&mut kb_header).map_err(|e| e.to_string())?;
    let kb_info_size = u64::from_be_bytes(kb_header[24..32].try_into().unwrap()) as usize;

    // Read first 32 bytes of key block info (8 header + 24 payload)
    let read_n = kb_info_size.min(32);
    let mut raw = vec![0u8; read_n];
    f.read_exact(&mut raw).map_err(|e| e.to_string())?;

    // Key: ripemd128(raw[4..8] + LE32(0x3695))
    let mut hasher = Ripemd128::new();
    hasher.update(&raw[4..8]);
    hasher.update(&0x3695u32.to_le_bytes());
    let key = hasher.finalize();

    // Helper: fast_decrypt variant (all bytes, relative idx, init_prev)
    let try_decrypt = |data: &[u8], start_byte: usize, use_abs_idx: bool, init_prev: u8| -> Vec<u8> {
        let mut out = data.to_vec();
        let mut prev = init_prev;
        // warm up state if start_byte > 0 (process header bytes just for state)
        if start_byte > 0 {
            for (i, &b) in data[..start_byte].iter().enumerate() {
                let ki = if use_abs_idx { i % 16 } else { i % 16 };
                prev = b.rotate_right(4) ^ key[ki];
            }
        }
        for (i, byte) in out[start_byte..].iter_mut().enumerate() {
            let abs_i = i + start_byte;
            let ki = if use_abs_idx { abs_i % 16 } else { i % 16 };
            let orig = *byte;
            let mut t = orig ^ prev;
            t = t.rotate_right(4);
            t ^= key[ki];
            prev = orig.rotate_right(4) ^ key[ki];
            *byte = t;
        }
        out[start_byte..].to_vec()
    };

    let kb_nums: Vec<u64> = (0..5)
        .map(|i| u64::from_be_bytes(kb_header[i*8..i*8+8].try_into().unwrap()))
        .collect();

    use encoding_rs::UTF_16LE;
    let (_xml, _, _) = UTF_16LE.decode(&header_bytes);
    // Strategy A: partial decrypt, bytes 8+, relative idx, prev=0x36
    let a = try_decrypt(&raw, 8, false, 0x36);
    // Strategy B: partial decrypt, bytes 8+, absolute idx, prev=0x36
    let b = try_decrypt(&raw, 8, true, 0x36);
    // Strategy C: full decrypt (all bytes), relative idx; then show bytes 8+
    let c = try_decrypt(&raw, 0, false, 0x36);
    // Strategy D: no decrypt, raw bytes 8+
    let d = raw[8..].to_vec();
    // Strategy E: partial decrypt, bytes 8+, relative idx, prev=0x00
    let e = try_decrypt(&raw, 8, false, 0x00);
    // Strategy F: full decrypt via state propagation through header (C gives header+payload)
    // C already computed all bytes, so bytes 8-23 of C = strategy F's payload
    let f_res = c[8..c.len().min(24)].to_vec();

    Ok(format!(
        "=== kb_nums: nb={} ne={} ki_decomp={} ki_size={} kb_size={} ===\n\
raw[0..8]  = {:02x?}\n\
raw[8..24] = {:02x?}\n\
key[0..8]  = {:02x?}\n\n\
A (partial, rel, prev=0x36):    {:02x?}\n\
B (partial, abs, prev=0x36):    {:02x?}\n\
C payload (full-all, bytes 8+): {:02x?}\n\
D (no decrypt / raw):           {:02x?}\n\
E (partial, rel, prev=0x00):    {:02x?}\n\
(expect 78 9c / 78 da / 78 01 at start)",
        kb_nums[0], kb_nums[1], kb_nums[2], kb_nums[3], kb_nums[4],
        &raw[..8], &raw[8..24.min(read_n)],
        &key[..8],
        &a[..a.len().min(12)],
        &b[..b.len().min(12)],
        &f_res[..f_res.len().min(12)],
        &d[..d.len().min(12)],
        &e[..e.len().min(12)],
    ))
}

fn dicts_dir() -> Result<std::path::PathBuf> {
    let dir = dirs::home_dir()
        .ok_or_else(|| anyhow::anyhow!("Cannot determine home directory"))?
        .join(".glean")
        .join("dicts");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Recursively copy all files from `src_dir` into `dst_dir` (flat, no sub-dirs).
fn copy_dir_flat(src_dir: &Path, dst_dir: &Path) -> Result<()> {
    for entry in std::fs::read_dir(src_dir)? {
        let entry = entry?;
        let src_path = entry.path();
        if src_path.is_file() {
            if let Some(name) = src_path.file_name() {
                std::fs::copy(&src_path, dst_dir.join(name))?;
            }
        }
    }
    Ok(())
}

fn import_dict_inner(dir_path: &str) -> Result<Dictionary> {
    let src_dir = Path::new(dir_path);
    if !src_dir.is_dir() {
        anyhow::bail!("Expected a directory: {dir_path}");
    }

    // Find the .mdx file inside the selected directory.
    let mdx_src = std::fs::read_dir(src_dir)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .find(|p| p.extension().and_then(|x| x.to_str()) == Some("mdx"))
        .ok_or_else(|| anyhow::anyhow!("No .mdx file found in the selected directory"))?;

    let stem = mdx_src.file_stem()
        .ok_or_else(|| anyhow::anyhow!("Invalid .mdx filename"))?
        .to_string_lossy()
        .to_string();

    // Stable ID from the mdx stem so re-importing the same dict is idempotent.
    let mut hasher = Sha256::new();
    hasher.update(stem.as_bytes());
    let id = hex::encode(&hasher.finalize()[..8]);

    // Destination: ~/.glean/dicts/<id>/
    let dest_dir = dicts_dir()?.join(&id);
    std::fs::create_dir_all(&dest_dir)?;

    // Skip copy if source and destination are the same directory.
    if src_dir.canonicalize().ok() != dest_dir.canonicalize().ok() {
        copy_dir_flat(src_dir, &dest_dir)?;
    }

    let dest_mdx = dest_dir.join(mdx_src.file_name().unwrap());
    let dest_str = dest_mdx.to_string_lossy().to_string();

    let meta = load_dict(&id, &dest_str)?;
    let name = if meta.title.is_empty() { stem } else { meta.title.clone() };

    let db = DB.get().unwrap().lock().unwrap();
    let sort_order: i64 = db.query_row(
        "SELECT COALESCE(MAX(sort_order) + 1, 0) FROM dictionaries",
        [],
        |row| row.get(0),
    ).unwrap_or(0);

    db.execute(
        "INSERT OR REPLACE INTO dictionaries (id, name, file_path, enabled, sort_order)
         VALUES (?1, ?2, ?3, 1, ?4)",
        params![id, name, dest_str, sort_order],
    )?;

    Ok(Dictionary {
        id,
        name,
        file_path: dest_str,
        enabled: true,
        sort_order,
        added_at: chrono::Local::now().to_rfc3339(),
    })
}

#[tauri::command]
pub async fn list_dictionaries() -> Result<Vec<Dictionary>, String> {
    let db = DB.get().unwrap().lock().unwrap();
    let mut stmt = db.prepare(
        "SELECT id, name, file_path, enabled, sort_order, added_at
         FROM dictionaries ORDER BY sort_order"
    ).map_err(|e| e.to_string())?;

    let dicts: Vec<Dictionary> = stmt
        .query_map([], |row| {
            Ok(Dictionary {
                id: row.get(0)?,
                name: row.get(1)?,
                file_path: row.get(2)?,
                enabled: row.get::<_, i64>(3)? != 0,
                sort_order: row.get(4)?,
                added_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(dicts)
}

#[tauri::command]
pub async fn update_dictionary_order(id: String, sort_order: i64) -> Result<(), String> {
    let db = DB.get().unwrap().lock().unwrap();
    db.execute(
        "UPDATE dictionaries SET sort_order=?1 WHERE id=?2",
        params![sort_order, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn toggle_dictionary(id: String, enabled: bool) -> Result<(), String> {
    let file_path: Option<String> = {
        let db = DB.get().unwrap().lock().unwrap();
        db.execute(
            "UPDATE dictionaries SET enabled=?1 WHERE id=?2",
            params![enabled as i64, id],
        ).map_err(|e| e.to_string())?;
        if enabled {
            db.query_row(
                "SELECT file_path FROM dictionaries WHERE id=?1",
                params![id],
                |row| row.get(0),
            ).ok()
        } else {
            None
        }
    };

    if enabled {
        if let Some(path) = file_path {
            load_dict(&id, &path).map_err(|e| e.to_string())?;
        }
    } else {
        unload_dict(&id);
    }
    Ok(())
}

#[tauri::command]
pub async fn remove_dictionary(id: String) -> Result<(), String> {
    unload_dict(&id);

    // Remove the dict's data directory under ~/.glean/dicts/<id>/
    if let Ok(dir) = dicts_dir() {
        let dict_dir = dir.join(&id);
        if dict_dir.is_dir() {
            std::fs::remove_dir_all(&dict_dir)
                .map_err(|e| format!("Failed to delete dict files: {e}"))?;
        }
    }

    let db = DB.get().unwrap().lock().unwrap();
    db.execute("DELETE FROM dictionaries WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn search_candidates(prefix: String) -> Result<Vec<String>, String> {
    if prefix.is_empty() {
        return Ok(vec![]);
    }
    DictIndex::prefix_search(&prefix, 50).map_err(|e| e.to_string())
}

fn follow_link(def: String, dict: &crate::dict::mdx::MdxDict, depth: u8) -> String {
    if depth == 0 { return def; }
    let trimmed = def.trim();
    if let Some(target) = trimmed.strip_prefix("@@@LINK=") {
        let target = target.trim();
        if let Ok(Some(next)) = dict.lookup(target) {
            return follow_link(next, dict, depth - 1);
        }
    }
    def
}

#[tauri::command]
pub async fn lookup_word(word: String) -> Result<Vec<DictResult>, String> {
    let (enabled_dicts, dict_names) = {
        let db = DB.get().unwrap().lock().unwrap();
        let mut stmt = db.prepare(
            "SELECT id, name FROM dictionaries WHERE enabled=1 ORDER BY sort_order"
        ).map_err(|e| e.to_string())?;
        let pairs: Vec<(String, String)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        let ids: Vec<String> = pairs.iter().map(|(id, _)| id.clone()).collect();
        let names: Vec<String> = pairs.iter().map(|(_, name)| name.clone()).collect();
        (ids, names)
    };

    // Record the query
    crate::db::record_query(&word, None).ok();

    let registry = DICT_REGISTRY
        .get()
        .ok_or("registry not init")?
        .read()
        .unwrap();

    let mut results = Vec::new();
    for (id, name) in enabled_dicts.iter().zip(dict_names.iter()) {
        if let Some(dict) = registry.get(id.as_str()) {
            if let Ok(Some(def)) = dict.lookup(&word) {
                // Follow @@@LINK= redirects (max 5 hops to avoid cycles)
                let resolved = follow_link(def, dict, 5);
                results.push(DictResult {
                    dict_id: id.clone(),
                    dict_name: name.clone(),
                    word: word.clone(),
                    definition: resolved,
                    css: dict.css.clone(),
                });
            }
        }
    }

    Ok(results)
}

#[tauri::command]
pub async fn get_recent_history(limit: i64) -> Result<Vec<String>, String> {
    let db = DB.get().unwrap().lock().unwrap();
    let mut stmt = db.prepare(
        "SELECT word FROM query_history GROUP BY word ORDER BY MAX(queried_at) DESC LIMIT ?1"
    ).map_err(|e| e.to_string())?;
    let words: Vec<String> = stmt
        .query_map(params![limit], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(words)
}

/// Load all enabled dicts at startup
pub fn preload_dicts() {
    let pairs: Vec<(String, String)> = {
        let db = DB.get().unwrap().lock().unwrap();
        let mut stmt = match db.prepare(
            "SELECT id, file_path FROM dictionaries WHERE enabled=1"
        ) {
            Ok(s) => s,
            Err(_) => return,
        };
        stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map(|rows| rows.filter_map(|r| r.ok()).collect::<Vec<_>>())
            .unwrap_or_default()
    };

    for (id, path) in pairs {
        if let Err(e) = load_dict(&id, &path) {
            log::warn!("Failed to preload dict {id}: {e}");
        }
    }
    DICTS_READY.store(true, Ordering::Relaxed);
}
