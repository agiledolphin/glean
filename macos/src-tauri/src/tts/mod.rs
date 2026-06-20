use anyhow::Result;
use crate::dict::DICT_REGISTRY;

/// Try to play audio from any loaded MDD file that has a match for `word`.
/// Returns true if audio was successfully handed off to a player process.
fn try_mdd_audio(word: &str) -> bool {
    let registry = match DICT_REGISTRY.get() {
        Some(r) => r.read().unwrap(),
        None => return false,
    };

    for dict in registry.values() {
        let mdd = match dict.mdd.as_ref() {
            Some(m) => m,
            None => continue,
        };

        match mdd.lookup_audio_for_word(word) {
            Ok(Some((data, ext))) => {
                if let Ok(played) = play_audio_bytes(&data, &ext) {
                    if played { return true; }
                }
            }
            Ok(None) => {}
            Err(e) => log::warn!("MDD audio lookup error: {e}"),
        }
    }
    false
}

fn play_audio_bytes(bytes: &[u8], ext: &str) -> Result<bool> {
    if bytes.len() < 8 {
        return Ok(false);
    }
    let tmp = std::env::temp_dir().join(format!("glean_audio.{ext}"));
    std::fs::write(&tmp, bytes)?;

    let ok = match ext {
        "mp3" | "m4a" | "aac" | "wav" | "aiff" | "caf" => {
            std::process::Command::new("afplay")
                .arg(&tmp)
                .spawn()
                .is_ok()
        }
        "spx" | "ogg" | "opus" => {
            // Requires ffplay (brew install ffmpeg)
            std::process::Command::new("ffplay")
                .args(["-nodisp", "-autoexit", "-loglevel", "quiet"])
                .arg(&tmp)
                .spawn()
                .is_ok()
        }
        _ => false,
    };
    Ok(ok)
}

/// Play audio for an exact MDD key from the dictionary HTML (e.g. "test__gb_1.mp3" from sound:// href).
#[tauri::command]
pub async fn play_mdd_audio(key: String) -> Result<(), String> {
    // href gives "test__gb_1.mp3"; MDD stores "\test__gb_1.mp3"
    let normalized = key.replace('/', "\\").to_lowercase();
    let mdd_key = if normalized.starts_with('\\') {
        normalized
    } else {
        format!("\\{}", normalized)
    };

    let registry = match DICT_REGISTRY.get() {
        Some(r) => r.read().unwrap(),
        None => return Ok(()),
    };
    for dict in registry.values() {
        if let Some(mdd) = dict.mdd.as_ref() {
            if let Ok(Some(data)) = mdd.lookup(&mdd_key) {
                let ext = mdd_key.rsplit('.').next().unwrap_or("mp3").to_string();
                if let Ok(true) = play_audio_bytes(&data, &ext) {
                    return Ok(());
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn play_pronunciation(word: String) -> Result<(), String> {
    if try_mdd_audio(&word) {
        return Ok(());
    }
    // Fallback: macOS TTS
    std::process::Command::new("say")
        .arg(&word)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
