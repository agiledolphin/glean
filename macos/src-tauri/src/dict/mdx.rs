//! MDict (.mdx) format parser — MDX version 2.0
//!
//! Encryption: when `Encrypted` header attribute is non-zero, the key block info
//! is encrypted with a stream cipher keyed by RIPEMD-128:
//!   key = ripemd128(data[4..8] || LE32(0x3695))
//! then `fast_decrypt(data, key)` is applied to all bytes.
//! After decryption the buffer has the standard layout:
//!   [4] compression type  [4] adler32  [N] zlib-compressed data

use anyhow::{bail, Context, Result};
use encoding_rs::{UTF_16LE, GBK, BIG5};
use flate2::read::ZlibDecoder;
use ripemd::{Ripemd128, Digest};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct DictMeta {
    pub title: String,
    pub description: String,
    pub encoding: String,
    pub version: f32,
    pub encrypted: u8,
}

impl DictMeta {
    pub fn is_utf16(&self) -> bool {
        let enc = self.encoding.to_uppercase();
        enc.is_empty() || enc == "UTF-16" || enc == "UTF16"
    }
    pub fn char_width(&self) -> usize {
        if self.is_utf16() { 2 } else { 1 }
    }
}

pub struct MdxDict {
    pub meta: DictMeta,
    pub css: Option<String>,
    pub js: Option<String>,
    pub mdd: Option<crate::dict::mdd::MddDict>,
    index: BTreeMap<String, RecordRef>,
    pub file_path: String,
    record_block_offset: u64,
}

#[derive(Debug, Clone)]
struct RecordRef {
    /// Byte offset in the concatenation of all decompressed record blocks.
    global_offset: u64,
}

#[derive(Serialize, Deserialize)]
struct MdxCache {
    record_block_offset: u64,
    index: BTreeMap<String, u64>,
}

fn cache_path_for(dict_path: &str) -> PathBuf {
    PathBuf::from(format!("{dict_path}.idx"))
}

fn load_mdx_cache(path: &Path) -> Option<MdxCache> {
    let data = std::fs::read(path).ok()?;
    bincode::deserialize(&data).ok()
}

fn save_mdx_cache(path: &Path, cache: &MdxCache) {
    if let Ok(data) = bincode::serialize(cache) {
        let _ = std::fs::write(path, data);
    }
}

impl MdxDict {
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self> {
        let path_str = path.as_ref().to_string_lossy().to_string();
        let file = File::open(&path).context("Cannot open MDX file")?;
        let mut reader = BufReader::new(file);

        let (meta, _) = read_header(&mut reader)
            .context("Failed to parse MDX header")?;

        log::debug!(
            "MDX: title={:?} encoding={:?} version={} encrypted={}",
            meta.title, meta.encoding, meta.version, meta.encrypted
        );

        let cache_path = cache_path_for(&path_str);
        let (index, record_block_offset) = if let Some(c) = load_mdx_cache(&cache_path) {
            log::debug!("MDX: loaded from cache ({} entries)", c.index.len());
            let idx = c.index.into_iter()
                .map(|(k, v)| (k, RecordRef { global_offset: v }))
                .collect();
            (idx, c.record_block_offset)
        } else {
            let (idx, rbo) = read_key_blocks(&mut reader, &meta)
                .context("Failed to parse MDX key blocks")?;
            let cache = MdxCache {
                record_block_offset: rbo,
                index: idx.iter().map(|(k, r)| (k.clone(), r.global_offset)).collect(),
            };
            save_mdx_cache(&cache_path, &cache);
            log::debug!("MDX: parsed and cached ({} entries)", idx.len());
            (idx, rbo)
        };

        // Load MDD first (needed as CSS fallback).
        let mdd_path = path.as_ref().with_extension("mdd");
        let mdd = if mdd_path.exists() {
            match crate::dict::mdd::MddDict::open(&mdd_path) {
                Ok(m) => { log::debug!("MDD loaded: {:?}", mdd_path); Some(m) }
                Err(e) => { log::warn!("Failed to load MDD {:?}: {e}", mdd_path); None }
            }
        } else {
            None
        };

        // CSS: try external file in same directory first, then extract from MDD.
        let css = path.as_ref().parent().and_then(|dir| {
            std::fs::read_dir(dir).ok()?.find_map(|e| {
                let p = e.ok()?.path();
                if p.extension()?.to_str()? == "css" {
                    std::fs::read_to_string(p).ok()
                } else {
                    None
                }
            })
        }).or_else(|| {
            let mdd = mdd.as_ref()?;
            let css_key = mdd.keys().find(|k| k.ends_with(".css"))?.to_string();
            let data = mdd.lookup(&css_key).ok()??;
            Some(String::from_utf8_lossy(&data).to_string())
        });

        // JS: some dicts (e.g. Oxford, Longman) ship a companion script driving
        // "+ More About" / "Word Origin" style expand-collapse widgets via inline
        // onclick handlers. Load it the same way as CSS so the frontend can inject it.
        let js = path.as_ref().parent().and_then(|dir| {
            std::fs::read_dir(dir).ok()?.find_map(|e| {
                let p = e.ok()?.path();
                if p.extension()?.to_str()? == "js" {
                    std::fs::read_to_string(p).ok()
                } else {
                    None
                }
            })
        }).or_else(|| {
            let mdd = mdd.as_ref()?;
            let js_key = mdd.keys().find(|k| k.ends_with(".js"))?.to_string();
            let data = mdd.lookup(&js_key).ok()??;
            Some(String::from_utf8_lossy(&data).to_string())
        });

        Ok(MdxDict { meta, css, js, mdd, index, file_path: path_str, record_block_offset })
    }

    pub fn prefix_search(&self, prefix: &str, limit: usize) -> Vec<String> {
        let lower = prefix.to_lowercase();
        self.index
            .range(lower.clone()..)
            .take_while(|(k, _)| k.starts_with(&lower))
            .filter(|(k, _)| !self.is_numeric_alias(k))
            .take(limit)
            .map(|(k, _)| k.clone())
            .collect()
    }

    /// Returns true for entries like "dream_1" / "dream_2" where the base "dream" also exists.
    /// These are @@@LINK= aliases in MDX dicts (e.g. OALD) and clutter the candidate list.
    fn is_numeric_alias(&self, key: &str) -> bool {
        if let Some(pos) = key.rfind('_') {
            let suffix = &key[pos + 1..];
            if !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_digit()) {
                return self.index.contains_key(&key[..pos]);
            }
        }
        false
    }

    pub fn lookup(&self, word: &str) -> Result<Option<String>> {
        let key = word.to_lowercase();
        let r = match self.index.get(&key).or_else(|| self.index.get(word)) {
            Some(r) => r.clone(),
            None => return Ok(None),
        };
        let file = File::open(&self.file_path)?;
        let mut reader = BufReader::new(file);
        let content = read_record(&mut reader, self.record_block_offset, &r, &self.meta)?;
        Ok(Some(content))
    }
}

// ─── Header ──────────────────────────────────────────────────────────────────

fn read_header<R: Read + Seek>(r: &mut R) -> Result<(DictMeta, u64)> {
    let mut buf4 = [0u8; 4];
    r.read_exact(&mut buf4)?;
    let header_len = u32::from_be_bytes(buf4) as usize;

    let mut header_bytes = vec![0u8; header_len];
    r.read_exact(&mut header_bytes)?;

    r.read_exact(&mut buf4)?; // skip checksum

    let (xml_str, _, _) = UTF_16LE.decode(&header_bytes);
    let meta = parse_header_xml(&xml_str)?;
    let offset = r.stream_position()?;
    Ok((meta, offset))
}

fn parse_header_xml(xml: &str) -> Result<DictMeta> {
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

    let version: f32 = get_attr("GeneratedByEngineVersion").parse().unwrap_or(2.0);
    if version < 2.0 {
        bail!("MDX version {version} < 2.0 is not supported");
    }
    let encrypted: u8 = get_attr("Encrypted").parse().unwrap_or(0);

    Ok(DictMeta {
        title: get_attr("Title"),
        description: get_attr("Description"),
        encoding: get_attr("Encoding"),
        version,
        encrypted,
    })
}

// ─── Encryption ──────────────────────────────────────────────────────────────

/// MDict key block info decryption (Encrypted != 0).
///
/// Layout in file: [4 type][4 adler32][N encrypted_zlib_payload]
/// Only the payload (bytes 8+) is encrypted. The 8-byte header is plaintext.
/// Key = ripemd128(data[4..8] ++ LE32(0x3695))
/// Apply fast_decrypt to bytes 8+ only (relative key index starting at 0).
fn decrypt_key_block_info(data: &mut Vec<u8>) {
    if data.len() < 9 {
        return;
    }
    let mut hasher = Ripemd128::new();
    hasher.update(&data[4..8]);
    hasher.update(&0x3695u32.to_le_bytes());
    let key = hasher.finalize();

    // Only decrypt the payload (bytes 8+); key index is relative (0-based from byte 8)
    fast_decrypt(&mut data[8..], &key);
}

/// XOR stream cipher used by MDict (_mdx_decrypt variant).
/// t = rotate_right_4(c) ^ b ^ (i & 0xff) ^ key[i % 16]; b = c
fn fast_decrypt(data: &mut [u8], key: &[u8]) {
    let klen = key.len();
    let mut prev: u8 = 0x36;
    for (i, byte) in data.iter_mut().enumerate() {
        let orig = *byte;
        *byte = orig.rotate_right(4) ^ prev ^ (i as u8) ^ key[i % klen];
        prev = orig;
    }
}

// ─── Key blocks ───────────────────────────────────────────────────────────────

fn read_key_blocks<R: Read + Seek>(
    r: &mut R,
    meta: &DictMeta,
) -> Result<(BTreeMap<String, RecordRef>, u64)> {
    let num_blocks      = read_be_u64(r)?;
    let _num_entries    = read_be_u64(r)?;
    let _kb_info_decomp = read_be_u64(r)?;
    let kb_info_size    = read_be_u64(r)?;
    let _kb_size        = read_be_u64(r)?;

    // ADLER32 checksum of the 5 header numbers (skip)
    let mut _chk = [0u8; 4];
    r.read_exact(&mut _chk)?;

    let mut info_bytes = vec![0u8; kb_info_size as usize];
    r.read_exact(&mut info_bytes)?;

    // Decrypt if necessary (Encrypted != 0)
    if meta.encrypted != 0 {
        log::debug!("Decrypting key block info (Encrypted={})", meta.encrypted);
        decrypt_key_block_info(&mut info_bytes);
    }

    let block_infos = parse_key_block_info(&info_bytes, num_blocks, meta)
        .context("parse_key_block_info failed")?;

    let mut index: BTreeMap<String, RecordRef> = BTreeMap::new();
    for (block_idx, info) in block_infos.iter().enumerate() {
        let mut compressed = vec![0u8; info.compressed_size as usize];
        r.read_exact(&mut compressed)?;

        let decompressed = decompress_block(&compressed, info.decompressed_size)
            .with_context(|| format!("decompress key block {block_idx}"))?;

        parse_key_block_entries(&decompressed, meta, &mut index)
            .with_context(|| format!("parse key block entries {block_idx}"))?;
    }

    let record_block_offset = r.stream_position()?;
    Ok((index, record_block_offset))
}

// ─── Key block info ───────────────────────────────────────────────────────────

#[derive(Debug)]
struct BlockInfo {
    compressed_size: u64,
    decompressed_size: u64,
}

fn parse_key_block_info(data: &[u8], num_blocks: u64, meta: &DictMeta) -> Result<Vec<BlockInfo>> {
    // First 4 bytes: compression type flag (0x00=none, 0x02=zlib)
    let decompressed = match data.get(..4) {
        Some(b"\x02\x00\x00\x00") => {
            let mut dec = ZlibDecoder::new(&data[8..]);
            let mut out = Vec::new();
            dec.read_to_end(&mut out).context("zlib decompress key block info")?;
            out
        }
        Some(b"\x00\x00\x00\x00") => data[8..].to_vec(),
        other => {
            bail!("unknown key block info compression type: {:02x?}", other);
        }
    };

    let cw = meta.char_width(); // 2 for UTF-16, 1 for UTF-8
    let mut infos = Vec::with_capacity(num_blocks as usize);
    let mut pos = 0usize;

    for i in 0..num_blocks {
        if pos + 8 > decompressed.len() {
            bail!("key block info truncated at block {i} (pos={pos} len={})", decompressed.len());
        }
        let _num_entries = u64::from_be_bytes(decompressed[pos..pos+8].try_into()?);
        pos += 8;

        // first key: [2 bytes length in chars] [length*cw bytes] [cw bytes null]
        if pos + 2 > decompressed.len() {
            bail!("key block info: first_key_len truncated at block {i}");
        }
        let first_len = u16::from_be_bytes(decompressed[pos..pos+2].try_into()?) as usize;
        pos += 2 + first_len * cw + cw;

        // last key
        if pos + 2 > decompressed.len() {
            bail!("key block info: last_key_len truncated at block {i}");
        }
        let last_len = u16::from_be_bytes(decompressed[pos..pos+2].try_into()?) as usize;
        pos += 2 + last_len * cw + cw;

        if pos + 16 > decompressed.len() {
            bail!("key block info: sizes truncated at block {i}");
        }
        let compressed_size   = u64::from_be_bytes(decompressed[pos..pos+8].try_into()?);
        pos += 8;
        let decompressed_size = u64::from_be_bytes(decompressed[pos..pos+8].try_into()?);
        pos += 8;

        infos.push(BlockInfo { compressed_size, decompressed_size });
    }

    Ok(infos)
}

// ─── Key block entries ────────────────────────────────────────────────────────

fn parse_key_block_entries(
    data: &[u8],
    meta: &DictMeta,
    index: &mut BTreeMap<String, RecordRef>,
) -> Result<()> {
    let mut pos = 0usize;
    while pos + 8 <= data.len() {
        let offset = u64::from_be_bytes(data[pos..pos+8].try_into()?);
        pos += 8;

        let key = if meta.is_utf16() {
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
            decode_bytes(raw, &meta.encoding)
        };

        if !key.is_empty() {
            index.entry(key.to_lowercase()).or_insert(RecordRef { global_offset: offset });
        }
    }
    Ok(())
}

fn decode_bytes(raw: &[u8], encoding: &str) -> String {
    match encoding.to_uppercase().as_str() {
        "GBK" | "GB2312" | "GB18030" => GBK.decode(raw).0.to_string(),
        "BIG5" => BIG5.decode(raw).0.to_string(),
        _ => String::from_utf8_lossy(raw).to_string(),
    }
}

// ─── Record blocks ────────────────────────────────────────────────────────────

fn decompress_block(data: &[u8], expected_size: u64) -> Result<Vec<u8>> {
    if data.len() < 8 {
        bail!("block data too short ({})", data.len());
    }
    let payload = &data[8..];
    match &data[..4] {
        b"\x00\x00\x00\x00" => Ok(payload.to_vec()),
        b"\x02\x00\x00\x00" => {
            let mut dec = ZlibDecoder::new(payload);
            let mut out = Vec::with_capacity(expected_size as usize);
            dec.read_to_end(&mut out)?;
            Ok(out)
        }
        other => {
            log::warn!("Unknown block compression {:02x?}, using raw", other);
            Ok(payload.to_vec())
        }
    }
}

fn read_record<R: Read + Seek>(
    r: &mut R,
    record_block_offset: u64,
    rec: &RecordRef,
    meta: &DictMeta,
) -> Result<String> {
    r.seek(SeekFrom::Start(record_block_offset))?;

    let num_blocks    = read_be_u64(r)?;
    let _num_entries  = read_be_u64(r)?;
    let _rb_info_size = read_be_u64(r)?;
    let _rb_size      = read_be_u64(r)?;

    let mut block_infos: Vec<(u64, u64)> = Vec::with_capacity(num_blocks as usize);
    for _ in 0..num_blocks {
        block_infos.push((read_be_u64(r)?, read_be_u64(r)?));
    }

    // Walk record blocks to find which one contains global_offset.
    let mut decomp_acc: u64 = 0;
    let mut target_idx = block_infos.len().saturating_sub(1);
    for (i, &(_, decomp_size)) in block_infos.iter().enumerate() {
        if rec.global_offset < decomp_acc + decomp_size {
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
    let decompressed = decompress_block(&compressed, decomp_size)?;

    let start = (rec.global_offset - decomp_acc) as usize;
    if start >= decompressed.len() {
        return Ok(String::new());
    }
    let slice = &decompressed[start..];

    let definition = if meta.is_utf16() {
        let mut chars = Vec::new();
        let mut i = 0;
        while i + 1 < slice.len() {
            let c = u16::from_le_bytes([slice[i], slice[i+1]]);
            i += 2;
            if c == 0 { break; }
            chars.push(c);
        }
        String::from_utf16_lossy(&chars).to_string()
    } else {
        let end = slice.iter().position(|&b| b == 0).unwrap_or(slice.len());
        decode_bytes(&slice[..end], &meta.encoding)
    };

    Ok(definition)
}

fn read_be_u64<R: Read>(r: &mut R) -> Result<u64> {
    let mut buf = [0u8; 8];
    r.read_exact(&mut buf)?;
    Ok(u64::from_be_bytes(buf))
}
