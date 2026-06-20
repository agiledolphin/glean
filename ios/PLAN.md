# 拾词 iOS — 开发计划

## 目标

将 macOS Tauri 版「拾词」移植为 iOS 原生 App，采用 SwiftUI + GRDB，长期维护。

## 技术栈

| 层级 | 技术 |
|------|------|
| UI | SwiftUI（iOS 17+） |
| 数据库 | GRDB.swift 6.x |
| MDX 解析 | Swift 自实现（待开发） |
| 状态管理 | SwiftUI `@Observable` |
| 最低系统 | iOS 17.0 |

## 项目结构

```
glean-ios/
├── project.yml                  # xcodegen 配置
├── GleanIOS.xcodeproj
└── GleanIOS/
    ├── App/
    │   ├── GleanApp.swift       # @main 入口
    │   └── ContentView.swift    # TabView（查词/生词本/背单词）
    ├── Database/
    │   └── AppDatabase.swift    # GRDB 初始化 + schema（与 macOS 版一致）
    ├── Models/
    │   ├── VocabularyWord.swift # vocabulary + tags + vocabulary_tags
    │   ├── ReviewCard.swift     # review_cards + SM-2 算法
    │   └── QueryHistory.swift   # query_history + word_stats
    └── Views/
        ├── SearchView.swift     # 查词页（占位）
        ├── VocabularyView.swift # 生词本列表（基础可用）
        └── ReviewView.swift     # 背单词统计 + 入口（占位）
```

## 数据库 Schema

与 macOS 版 `glean.db` 完全一致，为未来 iCloud 同步（生词本数据）留好基础：

- `vocabulary` — 生词本
- `tags` / `vocabulary_tags` — 标签体系
- `review_cards` — SM-2 复习记录
- `query_history` / `word_stats` — 查询历史与统计

## 开发阶段

### ✅ Phase 0 — 项目骨架
- [x] xcodegen 配置，GRDB 依赖
- [x] Database schema（与 macOS 版对齐）
- [x] GRDB Models（VocabularyWord、Tag、ReviewCard、QueryHistory）
- [x] TabView 三栏（查词 / 生词本 / 背单词）
- [x] iPhone 17 Pro 模拟器编译运行通过

### 🔲 Phase 1 — MDX 解析器（Swift）
- [ ] 单独建 Swift Package `MdxKit`
- [ ] Header 解析（UTF-16LE XML）
- [ ] Key block 解密（RIPEMD-128 + `_mdx_decrypt` 流密码）
- [ ] zlib 解压（Apple Compression 框架）
- [ ] Headword 索引（内存 Dictionary，支持前缀搜索）
- [ ] Record block 查找与解压
- [ ] 单元测试（用已知 MDX 文件验证）
- [ ] 集成进主 App

### 🔲 Phase 2 — 查词页
- [ ] 搜索框实时前缀搜索（防抖 120ms）
- [ ] 候选词列表
- [ ] 词典内容渲染（WKWebView + CSS 隔离）
- [ ] 收藏按钮（加入生词本）
- [ ] 词典文件导入（Files App / 文档选择器）

### 🔲 Phase 3 — 生词本
- [ ] 标签过滤栏
- [ ] 单词列表（虚拟滚动）
- [ ] 单词详情（词典内容 + 笔记编辑）
- [ ] 删除 / 标签管理

### 🔲 Phase 4 — 背单词
- [ ] 会话初始化（SM-2 到期词 + 新词，随机 20 词）
- [ ] 卡片翻转动画
- [ ] 四档评分（完全不记得 / 模糊 / 认识 / 很熟）
- [ ] 复习统计页

### 🔲 Phase 5 — 完善
- [ ] iCloud 同步（生词本 + 复习记录，不含词典文件）
- [ ] 深色模式适配
- [ ] 字体体系（匹配 macOS 版风格）
- [ ] App 图标 / 启动页

## 关键技术难点

### MDX 解析器
参考 macOS Rust 版 `src-tauri/src/dict/mdx.rs`：
- RIPEMD-128 需要 Swift 自实现（无标准库支持）
- `_mdx_decrypt` 流密码：`t = rotate_right_4(c) ^ prev ^ (i as u8) ^ key[i%16]`，`prev = c`（原始密文）
- `RecordRef.global_offset` 是跨所有解压 block 的绝对偏移，不是 block 内偏移
- 所有 headword 以小写索引，查词时先试小写再试原始大小写

### 词典文件导入
iOS 沙盒限制，用 `UIDocumentPickerViewController` 让用户从 Files App 选择 `.mdx` 目录，拷贝到 App 沙盒 `Documents/dicts/<id>/`。

## 编译命令

```bash
# 重新生成 xcodeproj（修改 project.yml 后）
cd /Users/jiaming/projects/glean-ios && xcodegen generate

# 编译
xcodebuild -project GleanIOS.xcodeproj -scheme GleanIOS \
           -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build

# 解析依赖
xcodebuild -resolvePackageDependencies -project GleanIOS.xcodeproj -scheme GleanIOS
```
