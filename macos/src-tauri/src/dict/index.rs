/// In-memory BTreeMap-based prefix index is implemented directly in MdxDict.
/// This module provides the cross-dict search facade.

use crate::db::DB;
use anyhow::Result;

/// Search across all enabled dicts' in-memory indices
pub struct DictIndex;

impl DictIndex {
    pub fn prefix_search(prefix: &str, limit: usize) -> Result<Vec<String>> {
        let registry = crate::dict::DICT_REGISTRY
            .get()
            .ok_or_else(|| anyhow::anyhow!("dict registry not initialized"))?
            .read()
            .unwrap();

        let db = DB.get().unwrap().lock().unwrap();
        let mut stmt = db.prepare(
            "SELECT id FROM dictionaries WHERE enabled=1 ORDER BY sort_order"
        )?;
        let enabled_ids: Vec<String> = stmt
            .query_map([], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();

        let mut seen = std::collections::HashSet::new();
        let mut results = Vec::new();

        for id in &enabled_ids {
            if let Some(dict) = registry.get(id.as_str()) {
                for word in dict.prefix_search(prefix, limit) {
                    if seen.insert(word.clone()) {
                        results.push(word);
                        if results.len() >= limit { break; }
                    }
                }
            }
            if results.len() >= limit { break; }
        }

        results.sort();
        Ok(results)
    }
}
