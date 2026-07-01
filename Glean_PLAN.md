# 拾词（Glean）产品设计与开发计划

> "每一个词，都值得被拾起。" / "Glean the beauty of every word."

---

## 一、项目概述

| 项目 | 内容 |
|------|------|
| 产品名称 | 拾词 / Glean |
| 目标平台 | macOS ✅、iOS（开发中）、Windows（后续） |
| 核心用户 | 碎片化记录词汇的外语学习者 |
| 当前版本 | v0.6.2 |
| macOS 技术栈 | Tauri 2.x + Rust + React 19 + TypeScript 6 + Vite 8 |
| iOS 技术栈 | SwiftUI + GRDB.swift 6.x + MdxKit（Swift Package） |
| 数据存储 | SQLite（本地，两端 schema 一致）|
| 数据目录 | `~/.glean/`（macOS）/ `Documents/dicts/`（iOS） |

---

## 二、技术架构

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────┐
│                   React 前端 (UI Layer)               │
│        TypeScript + Tailwind CSS + shadcn/ui         │
└────────────────────┬────────────────────────────────┘
                     │  Tauri IPC (invoke / events)
┌────────────────────▼────────────────────────────────┐
│               Tauri 核心层 (Rust Backend)             │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │  词典引擎     │  │  生词管理     │  │  配置管理  │  │
│  │ (MDict解析)  │  │ (标签/统计)  │  │           │  │
│  └──────────────┘  └──────────────┘  └───────────┘  │
│  ┌──────────────┐  ┌──────────────┐                  │
│  │  发音引擎     │  │  导入/导出    │                  │
│  │ (TTS/音频)   │  │  (Markdown)  │                  │
│  └──────────────┘  └──────────────┘                  │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│              数据层 (~/.glean/)                       │
│   glean.db (SQLite)  │  dicts/  │  config.toml      │
└─────────────────────────────────────────────────────┘
```

### 2.2 目录结构

数据目录：
```
~/.glean/                        # macOS 数据目录
├── glean.db
└── dicts/
    └── <id>/                    # id = SHA256(词典名)[:8]
        ├── *.mdx
        ├── *.mdd
        └── *.css

Documents/dicts/                 # iOS 设备数据目录（Simulator 直接读 ~/.glean/dicts/）
```

源码结构（单一 git repo）：
```
glean/                           # monorepo 根目录
├── CLAUDE.md
├── README.md
├── Glean_PLAN.md
├── macos/                       # macOS Tauri 应用
│   ├── src-tauri/               # Rust 后端
│   │   └── src/
│   │       ├── commands/        # Tauri commands
│   │       ├── dict/            # MDX + MDD 解析引擎
│   │       ├── db/              # SQLite 数据访问层
│   │       ├── tts/             # 发音模块
│   │       └── export/          # 导出模块
│   ├── src/                     # React 前端
│   │   ├── components/
│   │   ├── pages/
│   │   ├── store/               # Zustand 全局状态
│   │   └── styles/
│   └── package.json
└── ios/                         # iOS SwiftUI 应用
    ├── MdxKit/                  # Swift Package：MDX + MDD 解析器
    │   └── Sources/MdxKit/
    │       ├── MdxDict.swift    # MDX 2.0 解析器（含 CSS 提取）
    │       ├── MddDict.swift    # MDD 二进制资源解析器
    │       ├── RIPEMD128.swift  # 自实现 RIPEMD-128
    │       └── Zlib.swift       # zlib 封装
    ├── GleanIOS/
    │   ├── App/                 # 入口 + ContentView
    │   ├── Database/            # GRDB schema
    │   ├── Dict/                # DictManager（加载 + 查词）
    │   ├── Models/              # Vocabulary、ReviewCard、QueryHistory
    │   └── Views/               # SearchView、DictDetailView、VocabularyView…
    └── project.yml              # xcodegen 配置
```

---

## 三、数据库设计

### 3.1 核心表结构（SQLite）

```sql
-- 查询历史
CREATE TABLE query_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    word        TEXT NOT NULL,
    dict_id     TEXT,
    queried_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_query_history_word ON query_history(word);

-- 查询统计（按词聚合）
CREATE TABLE word_stats (
    word        TEXT PRIMARY KEY,
    query_count INTEGER DEFAULT 1,
    first_seen  DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 生词本
CREATE TABLE vocabulary (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    word        TEXT NOT NULL UNIQUE,
    note        TEXT,               -- 用户备注
    starred     INTEGER DEFAULT 0,  -- 星标
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 标签
CREATE TABLE tags (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL UNIQUE,
    color TEXT DEFAULT '#8FAF8F'
);

-- 生词-标签关联
CREATE TABLE vocabulary_tags (
    vocabulary_id INTEGER REFERENCES vocabulary(id) ON DELETE CASCADE,
    tag_id        INTEGER REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (vocabulary_id, tag_id)
);

-- 词典注册表
CREATE TABLE dictionaries (
    id          TEXT PRIMARY KEY,   -- SHA256(词典名)[:8]
    name        TEXT NOT NULL,
    file_path   TEXT NOT NULL,      -- ~/.glean/dicts/<id>/<name>.mdx
    enabled     INTEGER DEFAULT 1,
    sort_order  INTEGER DEFAULT 0,
    added_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 四、功能模块详细设计

### 4.1 词典查询

- 搜索框集成在顶部导航栏，始终可见
- 输入时实时触发前缀匹配（`input*`），在左侧候选列表中动态更新
- 用户点击候选词或按 Enter 确认后，右侧加载该词在所有已启用词典中的结果
- 每次确认查询自动更新 `query_history` 与 `word_stats`
- 右侧结果区按词典 `sort_order` 顺序排列，词典间以分隔线隔开

**MDict 解析方案：** 自实现 MDX 2.0 格式解析器（Rust），支持 zlib 压缩与 RIPEMD-128 加密（`Encrypted=2`）。

### 4.2 词典导入

- UI：点击选择**词典目录**（含 `.mdx` 及配套文件）
- 后端流程：
  1. 将目录内所有文件复制至 `~/.glean/dicts/<id>/`
  2. 读取词典头信息（标题、语言等）
  3. 自动加载同目录下的 `.css` 文件
  4. 写入 `dictionaries` 表
- 删除词典时同步删除 `~/.glean/dicts/<id>/` 整个目录
- 支持排序、启用/禁用、删除词典

### 4.3 CSS 渲染与样式隔离

- 词典目录中的 `.css` 文件在词典加载时读入内存
- 查询结果返回时携带 `css` 字段
- 前端使用 **Shadow DOM** 渲染每条词典结果，样式完全隔离，词典间互不干扰

### 4.4 单词发音

- **优先方案：** 若 MDD 资源包含音频，直接播放 MDD 中的 mp3/ogg
- **降级方案：** 调用系统 TTS（macOS `say` 命令 / Windows SAPI）或在线 TTS API（需网络）
- 支持英式/美式发音切换（取决于词典资源）

### 4.5 生词管理

- 查询结果页提供"加入生词本"按钮（一键收藏）
- 生词本视图：
  - 列表/卡片两种布局
  - 按标签筛选
  - 按添加时间/查询频次/字母排序
  - 支持批量操作（删除、打标签）
- 标签管理：自定义颜色、重命名、删除

### 4.6 查询统计

- 统计页展示：
  - 总查询次数、今日查询词数
  - 查询频次 Top 10（词云或列表）
  - 查询趋势图（近 7/30 天）
- 高频词可一键加入生词本

### 4.7 导出功能

- 支持将生词本（全部或按标签）导出为 Markdown 文件
- 导出格式：

```markdown
# 生词本 - [标签名] - 2026-04-25

## word
- **释义：** ...（来自词典的摘要）
- **备注：** 用户笔记
- **查询次数：** 5
- **加入时间：** 2026-04-20

---
```

---

## 五、UI/UX 设计规范

### 5.1 视觉风格

| 属性 | 规范 |
|------|------|
| 整体风格 | 简洁、淡雅、书卷气 |
| 主色调 | Flexoki Light — 暖纸白 `#fffcf0` / 深蓝 `#205ea6` |
| 辅助色 | 蓝/青/紫/绿/橙 Flexoki accent 色系 |
| 字体（中文标题） | 思源宋体 |
| 字体（中文 Slogan） | 霞鹜文楷（LXGW WenKai TC）|
| 字体（英文展示） | Cormorant Garamond |
| 字体（词典内容） | Inter / SF Pro |
| 圆角 | `8px`（卡片）/ `4px`（输入框）|
| 动效 | 轻微淡入淡出，避免过度动画 |

### 5.2 主要页面布局

```
┌──────────────────────────────────────────────────────────────┐
│  🌿 拾词          [🔍 输入单词...____________]  [生词本][统计][⚙️]  │  ← 顶部导航栏（搜索框居中）
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────┐  ┌───────────────────────────────────┐ │
│  │  候选词列表        │  │  查询结果                          │ │
│  │                  │  │                                   │ │
│  │  inform          │  │  ── Oxford Advanced ──────────    │ │
│  │  informal   ←选中 │  │  **informal** /ɪnˈfɔːml/  🔊     │ │
│  │  information     │  │  adj. 非正式的；不拘礼节的            │ │
│  │  informative     │  │  ...（词典富文本内容）...            │ │
│  │  informed        │  │                          [+ 收藏]  │ │
│  │  informer        │  │                                   │ │
│  │  ...             │  │  ── 朗文当代英语 ───────────────    │ │
│  │                  │  │  **informal** /ɪnˈfɔːməl/  🔊    │ │
│  │                  │  │  adj. 1. relaxed and friendly...  │ │
│  │                  │  │  ...（词典富文本内容）...            │ │
│  │                  │  │                                   │ │
│  └──────────────────┘  └───────────────────────────────────┘ │
│   ← 约 28% 宽度 →        ←────────── 约 72% 宽度 ──────────→   │
└──────────────────────────────────────────────────────────────┘
```

**左侧候选列表说明：**
- 用户在导航栏搜索框输入时，实时执行前缀查询（跨所有已启用词典的内存 BTreeMap 索引）
- 结果按字母序排列，限制展示约 50 条
- 鼠标悬停高亮，点击或键盘上下键选中后，右侧加载完整释义
- 无输入时列表显示最近查询历史

**右侧结果区说明：**
- 所有词典结果在同一滚动容器内顺序渲染
- 每个词典块顶部显示词典名称标题行作为分隔
- 词典 HTML 内容通过 Shadow DOM 渲染，样式完全隔离

### 5.3 窗口设计

- 默认窗口尺寸：`1000 × 660px`，可调整，最小宽度 `700px`
- macOS：使用 `NSVisualEffectView` 实现毛玻璃效果（Tauri 支持）

---

## 六、开发阶段规划

### Phase 0 — 项目初始化 ✅

- [x] 初始化 Tauri 2.x + React 18 + TypeScript 项目
- [x] 配置 Tailwind CSS + shadcn/ui 组件库
- [x] 建立 `~/.glean/` 目录与 SQLite 数据库初始化逻辑

### Phase 1 — 核心查询 ✅

- [x] MDict（.mdx）解析引擎实现（Rust），支持 MDX 2.0、zlib 压缩、RIPEMD-128 加密
- [x] 词典索引构建（内存 BTreeMap，支持前缀实时检索）
- [x] 词典以**目录方式**导入，文件复制至 `~/.glean/dicts/<id>/`，删除时同步清理
- [x] 词典 CSS 自动加载，Shadow DOM 渲染隔离
- [x] 顶部导航栏搜索框 + 左侧候选列表（实时前缀匹配）
- [x] 右侧多词典结果顺序渲染（分隔线布局）
- [x] 查询历史写入 `word_stats`

### Phase 2 — 生词管理 ✅

- [x] 收藏/加入生词本功能
- [x] 生词本列表页（排序/筛选）
- [x] 标签 CRUD 与词汇-标签关联
- [x] 用户备注编辑
- [ ] 批量操作（删除、打标签）（暂缓，用户习惯逐词标记）

### Phase 3 — 发音与资源渲染 ✅

- [x] MDD 二进制资源解析（音频、图片、CSS）
- [x] `mdd://` 自定义 URI scheme，浏览器直接加载 MDD 资源
- [x] Shadow DOM URL 重写（`/` → `\` 路径映射，图片/CSS 正确加载）
- [x] `sound://` 链接拦截，点击词典内发音按钮直接播放 MDD 音频
- [x] CSS 从 MDD 提取（无外部 .css 文件时自动降级）
- [x] 系统 TTS 降级方案（macOS `say` 命令）
- [x] 统计页面（查询次数、趋势图）

### Phase 4 — 性能、稳定性与打磨（进行中）

- [x] bincode 索引缓存（`.idx` 文件，避免每次重新解析大词典）
- [x] 后台线程加载词典，`dicts-ready` 事件通知前端
- [x] 竞态条件修复（`are_dicts_ready` 轮询，防止 fast-load 丢事件）
- [x] `toggle_dictionary` 实时同步内存注册表，无需重启
- [x] 词典结果区可折叠/展开
- [x] 生词本 Markdown 导出
- [x] UI 优化：Logo 重设计、macOS 交通灯间距、Slogan 排版
- [x] `@@@LINK=` 重定向跟随（别名条目自动指向目标词条内容）
- [x] 候选列表过滤数字别名词条（`dream_1` / `dream_2` 等不出现在列表）
- [x] 候选列表词典子目录（选中词展示来源词典，点击跳转对应区块）
- [x] 词典图标支持（读取词典目录图片；无图标时显示首字母彩色头像）
- [x] `/` 快捷键聚焦搜索框并全选
- [x] 自定义 Logo 整合（`icon.icns` / `icon.ico` / PNG 全尺寸生成）
- [x] MDD 索引缓存版本字段，防止旧格式缓存导致资源加载异常
- [x] 生词本页面重构：横向标签过滤条 + 双栏布局，词典详情与主界面统一
- [x] 标签管理优化：默认标签星形标识、颜色凸显、hover 操作按钮（display:none 方案修复 WebKit hover 卡死问题）
- [x] 查询历史 UI：分组标题 + 数量、近期记录扩展至 50 条
- [x] 切换生词本页自动清空搜索框与词典详情
- [x] 收藏逻辑优化：未选标签时自动归入默认标签组，收藏后同步实际标签状态
- [x] 打包发布（macOS .dmg）
- [x] 生词本笔记功能：折叠式笔记栏、手动保存、列表预览、「有笔记」筛选
- [x] 移除星级（1-5）评分，删除 `level` 数据库字段及相关代码
- [x] 生词本列表 UI 精简：去除 tag 标签显示、行距对齐、虚拟列表动态行高
- [x] 候选词列表字体与间距优化
- [x] 查词历史导航：搜索框左侧前进/后退按钮，会话内浏览器式栈导航
- [x] 整体配色重构：Flexoki Light 纸墨风，替换原莫兰迪绿书卷风
- [x] 字体体系重构：霞鹜文楷（Slogan）+ Cormorant Garamond（英文展示）+ 思源宋体（中文标题）
- [x] 关于页重设计：图标融合背景（mix-blend-mode）、双语名称、Slogan 横线排版
- [x] Logo 无边框化：全局 mix-blend-mode: multiply，图标直接融入暖纸背景
- [x] 依赖全面升级：React 19、TypeScript 6、Vite 8、Tailwind CSS 4、ESLint 10
- [x] Markdown 导出重构：平铺格式 `word  #tag1 #tag2`，原生 Save 对话框选路径/文件名
- [x] 收藏/发音/标签按钮 mousedown 时阻止抢占搜索框焦点，收藏后可直接继续打字查词
- [x] 词典释义内部引用链接可点击跳转查词（此前无条件 preventDefault，点击无反应）；http(s) 链接改为系统浏览器打开
- [ ] 设置页完善（发音偏好、主题等）

### Phase 5 — 背单词与进阶功能（进行中）

- [x] 卡片复习模式：SM-2 间隔重复算法，每次最多 20 词，四档评分（完全不记得/模糊/认识/很熟），翻牌显示词典原文
- [ ] Anki 导出（生成 `.apkg`）
- [ ] 全文检索（在词典定义内搜索）
- [ ] 快捷键（全局唤起、翻页、收藏）
- [ ] 深色 / 浅色主题切换
- [ ] 划词翻译（macOS Accessibility API）
- [ ] 拼音/模糊搜索
- [ ] 多设备同步（iCloud / WebDAV）
- [ ] Windows 版本

### iOS Phase 0 — 项目骨架 ✅

- [x] xcodegen 配置，GRDB 6.x 依赖
- [x] Database schema（与 macOS 版对齐：vocabulary、tags、review_cards、query_history）
- [x] GRDB Models（VocabularyWord、Tag、ReviewCard、QueryHistory）
- [x] TabView 三栏（查词 / 生词本 / 背单词）
- [x] iPhone 17 Pro 模拟器编译运行通过

### iOS Phase 1 — MDX + MDD 解析器 ✅

- [x] Swift Package `MdxKit` 建立
- [x] RIPEMD-128 自实现（4 标准测试向量全通过）
- [x] zlib 解压（C zlib 封装）
- [x] MDX 2.0 全解析：header、key blocks（加密/非加密）、record blocks
- [x] MDD 二进制资源解析器（`MddDict`）：key index + binary record 读取
- [x] CSS 自动提取：优先目录 `.css` 文件，无则从 `.mdd` 提取（参照 Rust 实现）
- [x] `@@@LINK=` 重定向跟随（最深 5 层）
- [x] 数字别名过滤（`dream_1` 等不出现在候选列表）
- [x] 集成测试（牛津、柯林斯、朗文实体词典验证）

### iOS Phase 2 — 查词页 ✅

- [x] DictManager：从 `~/.glean/dicts/`（Simulator）/ `Documents/dicts/`（设备）加载词典
- [x] DictManager：读取 `~/.glean/glean.db` 的 `sort_order`（SQLite3），词典顺序与 macOS 端对齐
- [x] SearchView：120ms debounce 前缀搜索，候选列表，NavigationLink
- [x] SearchView：`.textInputAutocapitalization(.never)` 禁用搜索框首字母自动大写
- [x] DictDetailView：多词典 tab 顶部切换，左右滑动翻页（TabView）
- [x] DictPageVC：UIViewController + WKWebView，per-dict 独立滚动
- [x] CSS 注入（baseCSS + dict.css，`li:empty { display: none }` 修复柯林斯空频率条）
- [x] baseURL 设为词典目录，支持相对路径资源加载

### iOS Phase 3 — 生词本与发音（v0.6.0，Simulator 验证通过 ✅）

- [x] 收藏按钮（加入生词本，DictDetailView 右上角书签，写入 GRDB vocabulary 表）
- [x] 查询历史写入 GRDB（SearchView 选词时写 query_history + upsert word_stats）
- [x] VocabularyView 完善（横向标签筛选条，按 tag_id 过滤）
- [x] 词典内 `sound://` 链接拦截 → AVFoundation 播放 MDD 音频（WKNavigationDelegate async 版）
- [x] 修复 GRDB Record camelCase/snake_case 字段映射缺失导致的静默写入失败（加 `databaseColumnDecodingStrategy`/`databaseColumnEncodingStrategy`）
- [ ] 词典文件导入（Files App，`UIDocumentPickerViewController`）

### iOS Phase 4 — 背单词与完善（待开发）

- [ ] SM-2 复习会话（与 macOS 版逻辑对齐）
- [ ] iCloud 同步（生词本 + 复习记录）
- [ ] 深色模式适配
- [ ] App 图标 / 启动页
- [ ] 字体体系（匹配 macOS 版 Flexoki 风格）

---

## 七、关键技术依赖

### macOS

| 模块 | 方案 | Crate / 库 |
|------|------|-----------|
| MDict 解析 | 自实现 MDX 2.0 解析器（支持加密） | `ripemd`, `flate2`, `encoding_rs` |
| MDD 资源解析 | 自实现，`mdd://` URI scheme 服务 | Tauri custom protocol |
| 词条前缀索引 | 内存 BTreeMap + bincode `.idx` 缓存 | `bincode`, Rust 标准库 |
| 数据库 | SQLite | `rusqlite` (bundled) |
| 前端状态管理 | Zustand | `zustand` |
| UI 组件 | shadcn/ui | React + Radix UI |
| 富文本渲染 | 词典 HTML + CSS，Shadow DOM 隔离，URL 重写 | 原生 Web API |
| 图表 | 统计页 | `recharts` |
| 发音 | MDD 音频优先，系统 TTS 降级 | Tauri shell（`afplay` / `say`）|

### iOS

| 模块 | 方案 | 库 |
|------|------|---|
| MDict 解析 | MdxKit Swift Package（自实现） | 纯 Swift + C zlib |
| MDD 资源解析 | MdxKit MddDict（同 MDX block 结构，binary value） | 纯 Swift |
| RIPEMD-128 | 完整自实现，4 测试向量验证 | 纯 Swift |
| 词条前缀索引 | 内存 Dictionary + 排序数组（前缀二分查找） | Swift 标准库 |
| 数据库 | SQLite（schema 与 macOS 版对齐） | GRDB.swift 6.x |
| UI | SwiftUI（iOS 17+）+ `@Observable` | Apple 框架 |
| 富文本渲染 | WKWebView（per-dict UIViewController），CSS 内联注入 | WebKit |
| 发音 | AVFoundation 播放 MDD 音频（WKNavigationDelegate 拦截 sound://） | AVFoundation |

---

## 八、MVP 交付标准

MVP（Phase 1-2 完成后）需满足：

1. ✅ 可导入至少一个 MDict 词典并正常查询
2. ✅ 顶部搜索框输入时左侧实时显示前缀匹配候选词
3. ✅ 右侧按词典顺序完整展示各词典内容，词典间有分隔
4. ✅ 词典 CSS 样式正确渲染且互相隔离
5. ✅ 支持将单词加入生词本并打标签
6. ✅ 生词本可按标签查看
7. ✅ 查询次数有记录并可查看
8. ✅ 应用可在 macOS 上正常打包运行

---

## 九、风险与应对

| 风险 | 说明 | 应对 |
|------|------|------|
| MDict 格式解析复杂 | MDX 格式有多个版本，加密方式各异 | 已实现 MDX 2.0 + RIPEMD-128 加密支持 |
| 大词典前缀检索性能 | 百万词条实时前缀匹配延迟 | 词典加载时在内存构建 BTreeMap 索引，查询无需磁盘 IO |
| 词典 HTML 样式冲突 | 不同词典内置 CSS 可能污染全局 | 已使用 Shadow DOM 完全隔离每条词典结果 |
| 音频兼容性 | 不同 MDD 格式编码不一 | 使用 macOS AVFoundation 原生播放，兼容多格式 |
| 词典版权 | 用户导入第三方词典 | 应用仅提供解析工具，词典文件由用户自行获取，不内置分发 |
