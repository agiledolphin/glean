/// MDD binary resource file parser (same block structure as MDX).
/// Keys are file paths (e.g. `\word.spx`); values are raw binary data.

use anyhow::{bail, Context, Result};
use encoding_rs::{UTF_16LE, GBK, BIG5};
use flate2::read::ZlibDecoder;
use ripemd::{Ripemd128, Digest};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

pub struct MddDict {
    file_path: String,
    /// Maps lowercase key -> global byte offset in concatenated decompressed record data.
    index: HashMap<String, u64>,
    record_block_offset: u64,
}

#[derive(Serialize, Deserialize)]
struct MddCache {
    version: u32,
    record_block_offset: u64,
    index: HashMap<String, u64>,
}

const CACHE_VERSION: u32 = 2;

fn load_mdd_cache(path: &Path) -> Option<MddCache> {
    let data = std::fs::read(path).ok()?;
    let cache: MddCache = bincode::deserialize(&data).ok()?;
    if cache.version != CACHE_VERSION { return None; }
    Some(cache)
}

fn save_mdd_cache(path: &Path, cache: &MddCache) {
    if let Ok(data) = bincode::serialize(cache) {
        let _ = std::fs::write(path, data);
    }
}

impl MddDict {
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self> {
        let path_str = path.as_ref().to_string_lossy().to_string();
        let cache_path = PathBuf::from(format!("{path_str}.idx"));

        if let Some(c) = load_mdd_cache(&cache_path) {
            log::debug!("MDD: loaded from cache ({} entries, {})", c.index.len(), path_str);
            return Ok(MddDict {
                file_path: path_str,
                index: c.index,
                record_block_offset: c.record_block_offset,
            });
        }

        let file = File::open(&path).context("Cannot open MDD file")?;
        let mut reader = BufReader::new(file);

        let (encoding, encrypted) = read_mdd_header(&mut reader)?;
        let index = read_mdd_key_blocks(&mut reader, &encoding, encrypted)?;
        let record_block_offset = reader.stream_position()?;

        log::debug!("MDD: parsed and cached ({} entries, {})", index.len(), path_str);

        let cache = MddCache { version: CACHE_VERSION, record_block_offset, index: index.clone() };
        save_mdd_cache(&cache_path, &cache);

        Ok(MddDict { file_path: path_str, index, record_block_offset })
    }

    /// Returns the audio bytes for the given key (case-insensitive).
    pub fn lookup(&self, key: &str) -> Result<Option<Vec<u8>>> {
        let lower = key.to_lowercase();
        let &global_offset = match self.index.get(&lower) {
            Some(o) => o,
            None => return Ok(None),
        };
        // Find the next entry's global offset to bound this entry's size.
        let next_global = self.index.values()
            .filter(|&&o| o > global_offset)
            .min()
            .copied();
        let file = File::open(&self.file_path)?;
        let mut reader = BufReader::new(file);
        let data = read_binary_record(&mut reader, self.record_block_offset, global_offset, next_global)?;
        if data.is_empty() { Ok(None) } else { Ok(Some(data)) }
    }

    /// Iterate all keys (for debugging).
    pub fn keys(&self) -> impl Iterator<Item = &str> {
        self.index.keys().map(|s| s.as_str())
    }

    /// Try common audio key patterns for a headword; return the first match.
    /// `accent` is "gb" to prefer British pronunciation, anything else (default "us") for American.
    /// Falls back to the opposite accent, then to accent-less files, if the preferred accent
    /// isn't available in this dictionary.
    pub fn lookup_audio_for_word(&self, word: &str, accent: &str) -> Result<Option<(Vec<u8>, String)>> {
        self.lookup_audio_impl(word, accent, true)
    }

    /// Like `lookup_audio_for_word` but only matches audio explicitly tagged with the
    /// preferred accent — never the opposite accent, never an accent-less generic file.
    /// With several dictionaries loaded, iteration order over them is unspecified, so without
    /// this a dict that only exposes a generic/opposite-accent file could win over another dict
    /// that actually has the preferred accent, just by being checked first.
    pub fn lookup_audio_strict(&self, word: &str, accent: &str) -> Result<Option<(Vec<u8>, String)>> {
        self.lookup_audio_impl(word, accent, false)
    }

    fn lookup_audio_impl(&self, word: &str, accent: &str, allow_fallback: bool) -> Result<Option<(Vec<u8>, String)>> {
        let w = word.to_lowercase();
        let gb_first = accent == "gb";
        let (preferred, other) = if gb_first { ("gb", "us") } else { ("us", "gb") };

        // OALD / Oxford pattern: \word__us_N.mp3 / \word__gb_N.mp3
        let mut patterns: Vec<String> = vec![
            format!("\\{w}__{preferred}_1.mp3"),
            format!("\\{w}__{preferred}_2.mp3"),
            format!("\\{w}__{preferred}_1.spx"),
            format!("\\{w}__{preferred}_2.spx"),
            format!("\\{w}_{preferred}.mp3"),
            format!("\\{w}_{preferred}.spx"),
        ];
        if allow_fallback {
            patterns.extend([
                format!("\\{w}__{other}_1.mp3"),
                format!("\\{w}__{other}_2.mp3"),
                format!("\\{w}__{other}_1.spx"),
                format!("\\{w}__{other}_2.spx"),
                format!("\\{w}_{other}.mp3"),
                format!("\\{w}_{other}.spx"),
                // Simple patterns (no accent info)
                format!("\\{w}.mp3"),
                format!("\\{w}.spx"),
                // By first letter subdirectory
                format!("\\{}\\{w}.mp3", &w[..w.chars().next().map_or(1, |c| c.len_utf8())]),
                format!("\\{}\\{w}.spx", &w[..w.chars().next().map_or(1, |c| c.len_utf8())]),
            ]);
        }
        for pat in &patterns {
            if let Ok(Some(data)) = self.lookup(pat) {
                let ext = pat.rsplit('.').next().unwrap_or("mp3").to_string();
                return Ok(Some((data, ext)));
            }
        }

        // Fallback: scan all keys for any audio file whose stem matches \word__ or \_word__
        // Handles Oxford OALD10's \_word__ams_N.mp3 / \_word__gbs_N.mp3 scheme.
        let prefix_plain = format!("\\{w}__");
        let prefix_under = format!("\\_{w}__");
        let pref_tokens: &[&str] = if gb_first { &["gb", "gbs"] } else { &["us", "ams"] };
        let other_tokens: &[&str] = if gb_first { &["us", "ams"] } else { &["gb", "gbs"] };

        // Rank 0 = preferred accent, 1 = opposite accent (only when fallback allowed),
        // 2 = no recognizable accent marker (only when fallback allowed). None = excluded.
        let rank = |k: &str| -> Option<u8> {
            let suffix = k.strip_prefix(prefix_plain.as_str())
                .or_else(|| k.strip_prefix(prefix_under.as_str()))
                .unwrap_or(k);
            if pref_tokens.iter().any(|t| suffix.starts_with(t)) { return Some(0); }
            if !allow_fallback { return None; }
            if other_tokens.iter().any(|t| suffix.starts_with(t)) { return Some(1); }
            Some(2)
        };

        let candidate = self.index.keys()
            .filter(|k| {
                (k.starts_with(&prefix_plain) || k.starts_with(&prefix_under))
                    && (k.ends_with(".mp3") || k.ends_with(".spx") || k.ends_with(".ogg"))
            })
            .filter_map(|k| rank(k).map(|r| (r, k)))
            // Prefer the chosen accent, then plain-prefix (headword) over underscore-prefix
            // (examples), then alphabetical.
            .min_by(|(ra, a), (rb, b)| {
                ra.cmp(rb).then_with(|| {
                    let a_plain = a.starts_with(&prefix_plain);
                    let b_plain = b.starts_with(&prefix_plain);
                    match (a_plain, b_plain) {
                        (true, false) => std::cmp::Ordering::Less,
                        (false, true) => std::cmp::Ordering::Greater,
                        _ => a.cmp(b),
                    }
                })
            })
            .map(|(_, k)| k.clone());

        if let Some(key) = candidate {
            if let Ok(Some(data)) = self.lookup(&key) {
                let ext = key.rsplit('.').next().unwrap_or("mp3").to_string();
                return Ok(Some((data, ext)));
            }
        }

        Ok(None)
    }
}

// ─── Header ─────────────────────────────────────────────────────────────────

fn read_mdd_header<R: Read + Seek>(r: &mut R) -> Result<(String, u8)> {
    let mut buf4 = [0u8; 4];
    r.read_exact(&mut buf4)?;
    let header_len = u32::from_be_bytes(buf4) as usize;
    let mut header_bytes = vec![0u8; header_len];
    r.read_exact(&mut header_bytes)?;
    r.read_exact(&mut buf4)?; // checksum

    let (xml, _, _) = UTF_16LE.decode(&header_bytes);
    let get_attr = |name: &str| -> String {
        let pat = format!("{}=\"", name);
        if let Some(start) = xml.find(&pat) {
            let after = &xml[start + pat.len()..];
            if let Some(end) = after.find('"') {
                return after[..end].to_string();
            }
        }
        String::new()
    };

    let encoding = get_attr("Encoding");
    let encrypted: u8 = get_attr("Encrypted").parse().unwrap_or(0);
    Ok((encoding, encrypted))
}

// ─── Encryption (identical to mdx.rs) ───────────────────────────────────────

fn fast_decrypt(data: &mut [u8], key: &[u8]) {
    let klen = key.len();
    let mut prev: u8 = 0x36;
    for (i, byte) in data.iter_mut().enumerate() {
        let orig = *byte;
        *byte = orig.rotate_right(4) ^ prev ^ (i as u8) ^ key[i % klen];
        prev = orig;
    }
}

fn decrypt_key_block_info(data: &mut Vec<u8>) {
    if data.len() < 9 { return; }
    let mut hasher = Ripemd128::new();
    hasher.update(&data[4..8]);
    hasher.update(&0x3695u32.to_le_bytes());
    let key = hasher.finalize();
    fast_decrypt(&mut data[8..], &key);
}

// ─── Key blocks ─────────────────────────────────────────────────────────────

fn read_mdd_key_blocks<R: Read + Seek>(
    r: &mut R,
    encoding: &str,
    encrypted: u8,
) -> Result<HashMap<String, u64>> {
    let num_blocks   = read_be_u64(r)?;
    let _num_entries = read_be_u64(r)?;
    let _ki_decomp   = read_be_u64(r)?;
    let ki_size      = read_be_u64(r)?;
    let _kb_size     = read_be_u64(r)?;
    let mut _chk = [0u8; 4];
    r.read_exact(&mut _chk)?;

    let mut info_bytes = vec![0u8; ki_size as usize];
    r.read_exact(&mut info_bytes)?;
    if encrypted != 0 {
        decrypt_key_block_info(&mut info_bytes);
    }

    // Parse block infos
    let block_infos = parse_key_block_info_mdd(&info_bytes, num_blocks, encoding)?;

    let mut index: HashMap<String, u64> = HashMap::new();
    for info in &block_infos {
        let mut compressed = vec![0u8; info.compressed_size as usize];
        r.read_exact(&mut compressed)?;
        let decompressed = decompress_block_mdd(&compressed, info.decompressed_size)?;
        parse_key_entries_mdd(&decompressed, encoding, &mut index)?;
    }
    Ok(index)
}

#[derive(Debug)]
struct BlockInfo { compressed_size: u64, decompressed_size: u64 }

fn parse_key_block_info_mdd(data: &[u8], num_blocks: u64, encoding: &str) -> Result<Vec<BlockInfo>> {
    let decompressed = match data.get(..4) {
        Some(b"\x02\x00\x00\x00") => {
            let mut dec = ZlibDecoder::new(&data[8..]);
            let mut out = Vec::new();
            dec.read_to_end(&mut out).context("zlib decompress MDD key block info")?;
            out
        }
        Some(b"\x00\x00\x00\x00") => data[8..].to_vec(),
        other => bail!("unknown MDD key block info compression: {:02x?}", other),
    };

    // MDD keys are usually UTF-16 (2 bytes per char) if encoding is empty/UTF-16,
    // else 1 byte per char (GBK etc.)
    let is_utf16 = {
        let enc = encoding.to_uppercase();
        enc.is_empty() || enc == "UTF-16" || enc == "UTF16"
    };
    let cw = if is_utf16 { 2usize } else { 1 };

    let mut infos = Vec::with_capacity(num_blocks as usize);
    let mut pos = 0usize;
    for i in 0..num_blocks {
        if pos + 8 > decompressed.len() {
            bail!("MDD key block info truncated at block {i}");
        }
        pos += 8; // num_entries
        if pos + 2 > decompressed.len() { bail!("MDD ki: first_key_len truncated"); }
        let flen = u16::from_be_bytes(decompressed[pos..pos+2].try_into()?) as usize;
        pos += 2 + flen * cw + cw;
        if pos + 2 > decompressed.len() { bail!("MDD ki: last_key_len truncated"); }
        let llen = u16::from_be_bytes(decompressed[pos..pos+2].try_into()?) as usize;
        pos += 2 + llen * cw + cw;
        if pos + 16 > decompressed.len() { bail!("MDD ki: sizes truncated"); }
        let compressed_size   = u64::from_be_bytes(decompressed[pos..pos+8].try_into()?); pos+=8;
        let decompressed_size = u64::from_be_bytes(decompressed[pos..pos+8].try_into()?); pos+=8;
        infos.push(BlockInfo { compressed_size, decompressed_size });
    }
    Ok(infos)
}

fn parse_key_entries_mdd(data: &[u8], encoding: &str, index: &mut HashMap<String, u64>) -> Result<()> {
    let is_utf16 = {
        let enc = encoding.to_uppercase();
        enc.is_empty() || enc == "UTF-16" || enc == "UTF16"
    };
    let mut pos = 0usize;
    while pos + 8 <= data.len() {
        let offset = u64::from_be_bytes(data[pos..pos+8].try_into()?);
        pos += 8;
        let key = if is_utf16 {
            let mut chars = Vec::new();
            while pos + 1 < data.len() {
                let c = u16::from_le_bytes([data[pos], data[pos+1]]);
                pos += 2;
                if c == 0 { break; }
                chars.push(c);
            }
            String::from_utf16_lossy(&chars).to_string()
        } else {
            let start = pos;
            while pos < data.len() && data[pos] != 0 { pos += 1; }
            let raw = &data[start..pos];
            pos += 1;
            match encoding.to_uppercase().as_str() {
                "GBK" | "GB2312" | "GB18030" => GBK.decode(raw).0.to_string(),
                "BIG5" => BIG5.decode(raw).0.to_string(),
                _ => String::from_utf8_lossy(raw).to_string(),
            }
        };
        if !key.is_empty() {
            index.entry(key.to_lowercase()).or_insert(offset);
        }
    }
    Ok(())
}

// ─── Record reading ──────────────────────────────────────────────────────────

fn decompress_block_mdd(data: &[u8], expected_size: u64) -> Result<Vec<u8>> {
    if data.len() < 8 { bail!("MDD block too short"); }
    let payload = &data[8..];
    match &data[..4] {
        b"\x00\x00\x00\x00" => Ok(payload.to_vec()),
        b"\x02\x00\x00\x00" => {
            let mut dec = ZlibDecoder::new(payload);
            let mut out = Vec::with_capacity(expected_size as usize);
            dec.read_to_end(&mut out)?;
            Ok(out)
        }
        _ => Ok(payload.to_vec()),
    }
}

fn read_binary_record<R: Read + Seek>(
    r: &mut R,
    record_block_offset: u64,
    global_offset: u64,
    next_global: Option<u64>,
) -> Result<Vec<u8>> {
    r.seek(SeekFrom::Start(record_block_offset))?;
    let num_blocks    = read_be_u64(r)?;
    let _num_entries  = read_be_u64(r)?;
    let _rb_info_size = read_be_u64(r)?;
    let _rb_size      = read_be_u64(r)?;

    let mut block_infos: Vec<(u64, u64)> = Vec::with_capacity(num_blocks as usize);
    for _ in 0..num_blocks {
        block_infos.push((read_be_u64(r)?, read_be_u64(r)?));
    }

    // Find target block by walking decompressed sizes
    let mut decomp_acc: u64 = 0;
    let mut target_idx = block_infos.len().saturating_sub(1);
    for (i, &(_, decomp_size)) in block_infos.iter().enumerate() {
        if global_offset < decomp_acc + decomp_size {
            target_idx = i;
            break;
        }
        decomp_acc += decomp_size;
    }

    let skip: u64 = block_infos[..target_idx].iter().map(|(c, _)| c).sum();
    r.seek(SeekFrom::Current(skip as i64))?;

    let (comp_size, decomp_size) = block_infos[target_idx];
    let mut compressed = vec![0u8; comp_size as usize];
    r.read_exact(&mut compressed)?;
    let decompressed = decompress_block_mdd(&compressed, decomp_size)?;

    let start = (global_offset - decomp_acc) as usize;
    if start >= decompressed.len() {
        return Ok(vec![]);
    }
    // End: if next entry is within the same block, stop before it; else use block end.
    let block_end = decomp_acc + decompressed.len() as u64;
    let end = match next_global {
        Some(next) if next < block_end => (next - decomp_acc) as usize,
        _ => decompressed.len(),
    };
    Ok(decompressed[start..end].to_vec())
}

fn read_be_u64<R: Read>(r: &mut R) -> Result<u64> {
    let mut buf = [0u8; 8];
    r.read_exact(&mut buf)?;
    Ok(u64::from_be_bytes(buf))
}
