# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### macOS app (`macos/`)

```bash
# Full dev (starts Vite + Rust backend together)
cd macos && npm run tauri dev

# Frontend only
cd macos && npm run dev

# Type-check frontend (no emit)
cd macos && npx tsc --noEmit

# Lint frontend
cd macos && npm run lint

# Build Rust backend only (fast iteration)
cargo build --manifest-path macos/src-tauri/Cargo.toml

# Release build
cd macos && npm run tauri build
```

Rust compile errors surface in the terminal running `npm run tauri dev`. There are no automated tests.

### iOS app (`ios/`)

`GleanIOS.xcodeproj` is 100% generated from `project.yml` and is not committed (gitignored) —
run `./generate.sh` once after cloning before opening it.

```bash
# Run MdxKit unit tests
cd ios/MdxKit && swift test

# Regenerate Xcode project from project.yml (reads DEVELOPMENT_TEAM from
# gitignored ios/.dev-team if present; plain `xcodegen generate` also works
# but leaves DEVELOPMENT_TEAM as a literal "${GLEAN_DEV_TEAM}" placeholder,
# fine for Simulator, breaks real-device signing)
cd ios && ./generate.sh

# Open in Xcode
open ios/GleanIOS.xcodeproj
```

## Python

Use `uv` to run Python scripts and manage dependencies. Never call `python` or `pip` directly.

```bash
uv run script.py          # run a script
uv run python -c "..."    # one-liner
uv add <package>          # add dependency
uv sync                   # install dependencies
```

## Architecture

This is a Tauri 2.x desktop app (macOS-first). The React frontend communicates with the Rust backend exclusively via Tauri `invoke` calls.

### Data flow

```
User types → Navbar (debounced 120ms) → invoke("search_candidates")
                                       → DictIndex::prefix_search (in-memory BTreeMap)
                                       → CandidateList

User selects word → invoke("lookup_word") → MdxDict::lookup (file seek)
                                          → DictResultPanel (Shadow DOM render)
```

### Rust backend (`macos/src-tauri/src/`)

- **`lib.rs`** — entry point: initialises DB, dict registry, preloads enabled dicts, registers all Tauri commands.
- **`db/mod.rs`** — single `OnceCell<Mutex<Connection>>` for SQLite. Schema is created on first run. `record_query()` upserts into both `query_history` and `word_stats`.
- **`dict/mdx.rs`** — MDX 2.0 parser. On `open()`: parses header (UTF-16LE XML), decrypts key block info if `Encrypted=2` (RIPEMD-128 + `_mdx_decrypt` stream cipher), decompresses and indexes all headwords into a `BTreeMap<String, RecordRef>`. `RecordRef` stores a **global byte offset** across the concatenated decompressed record blocks (not a block-local offset). Lookups seek to the correct record block by walking decompressed-size accumulators.
- **`dict/mod.rs`** — `DICT_REGISTRY: OnceCell<RwLock<HashMap<String, MdxDict>>>`. `load_dict` opens an MDX and inserts it; `unload_dict` removes it.
- **`dict/index.rs`** — `DictIndex::prefix_search` acquires the registry read lock and the DB lock (in that order) to query enabled dicts.
- **`commands/dict_commands.rs`** — import takes a **directory path**, finds the `.mdx` inside, copies the whole directory to `~/.glean/dicts/<id>/` (id = SHA256(stem)[:8]). Delete removes the directory. `lookup_word` returns `css: Option<String>` alongside each result.

### Frontend (`macos/src/`)

- **`store/index.ts`** — single Zustand store for all shared state: search query, candidates, selected word, dict results, dictionaries, vocabulary, tags.
- **`lib/commands.ts`** — thin wrappers around `invoke<T>(command, args)`. All backend calls go through here.
- **`components/DictResultPanel.tsx`** — renders each `DictResult` inside a Shadow DOM host (`attachShadow({ mode: "open" })`). This isolates per-dictionary CSS from the app and from other dictionaries. The `<style>` + HTML are set via `shadow.innerHTML`.
- **`components/CandidateList.tsx`** — on word select, calls `lookupWord` and pushes results into the store.
- **`components/Navbar.tsx`** — owns the search input. Empty query → `getRecentHistory(20)`; non-empty → `searchCandidates(prefix)`.

### Storage layout

```
~/.glean/
├── glean.db
└── dicts/
    └── <id>/          # one subdirectory per dictionary
        ├── *.mdx
        ├── *.mdd      # optional audio/images
        └── *.css      # optional stylesheet (auto-loaded)
```

### Key invariants

- The `DICT_REGISTRY` write lock is held only during import/preload. Never hold the DB mutex while holding the registry write lock (deadlock risk).
- `RecordRef.global_offset` is an absolute offset into the concatenation of all decompressed record blocks. To resolve it: iterate record block infos, accumulate `decompressed_size`, find the block where `global_offset < acc + decomp_size`, then `local = global_offset - acc`.
- All headwords are indexed in lowercase. `lookup_word` tries `word.to_lowercase()` first, then the original casing.
- The `fast_decrypt` cipher in `mdx.rs` implements the `_mdx_decrypt` variant (not `_fast_decrypt`): `t = rotate_right_4(c) ^ prev ^ (i as u8) ^ key[i%16]`, with `prev = c` (raw ciphertext, not derived).
