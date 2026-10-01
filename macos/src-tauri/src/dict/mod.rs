pub mod mdx;
pub mod mdd;
pub mod index;

pub use mdx::{MdxDict, DictMeta};
pub use index::DictIndex;

use anyhow::Result;
use once_cell::sync::OnceCell;
use std::collections::HashMap;
use std::sync::RwLock;

/// Global dict registry: dict_id -> loaded MdxDict
pub static DICT_REGISTRY: OnceCell<RwLock<HashMap<String, MdxDict>>> = OnceCell::new();

pub fn init_registry() {
    DICT_REGISTRY.get_or_init(|| RwLock::new(HashMap::new()));
}

pub fn load_dict(id: &str, path: &str) -> Result<DictMeta> {
    let dict = MdxDict::open(path)?;
    let meta = dict.meta.clone();
    DICT_REGISTRY
        .get()
        .unwrap()
        .write()
        .unwrap()
        .insert(id.to_string(), dict);
    Ok(meta)
}

pub fn unload_dict(id: &str) {
    if let Some(reg) = DICT_REGISTRY.get() {
        reg.write().unwrap().remove(id);
    }
}
