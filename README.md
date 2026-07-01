# 拾词 · Glean

> 每一个词，都值得被拾起。  
> *Glean the beauty of every word.*

**拾词（Glean）** 是一款面向外语学习者的 MDict 词典应用，支持导入 MDict（`.mdx` / `.mdd`）格式词典，提供流畅的查询体验与生词管理功能。

| 平台 | 状态 | 技术栈 |
|------|------|--------|
| macOS | ✅ v0.6.1 | Tauri 2.x + Rust + React 19 |
| iOS | ✅ v0.6.0（查词/收藏/历史/生词本/发音） | SwiftUI + MdxKit (Swift) |

---

## 功能特性

- **MDict 词典支持** — 自实现 MDX 2.0 解析引擎（Rust），支持 zlib 压缩与 RIPEMD-128 加密，兼容牛津、柯林斯、朗文等主流词典
- **实时前缀检索** — 内存 BTreeMap 索引，输入即响应，无磁盘 IO 延迟
- **多词典并排** — 同时查询所有已启用词典，结果顺序渲染，各词典可独立折叠/展开
- **Shadow DOM 样式隔离** — 每条词典结果在独立 Shadow DOM 中渲染，词典间 CSS 完全隔离
- **MDD 资源渲染** — 图片、发音图标通过 `mdd://` 自定义协议直接加载，无需解压
- **词典内音频播放** — 拦截 `sound://` 链接，点击即播放 MDD 内嵌音频；无音频时降级至系统 TTS
- **生词本管理** — 一键收藏、自定义标签、用户备注、Markdown 导出（平铺格式，原生存储对话框）
- **背单词** — SM-2 间隔重复算法，每次 20 词，四档评分，翻牌显示词典原文
- **查询统计** — 记录查询历史，展示高频词与查询趋势图
- **词典子目录** — 候选列表中展示当前词的来源词典，点击跳转对应区块
- **历史记录导航** — 搜索框左侧前进/后退按钮，会话内浏览器式查词历史切换
- **键盘友好** — `/` 快捷键聚焦搜索框，Enter 直接查词

---

## 截图

> *(待补充)*

---

## 安装与使用

### 系统要求

- macOS 12 (Monterey) 或更高版本

### 下载

前往 [Releases](../../releases) 页面下载最新版 `.dmg` 安装包。

### 导入词典

1. 准备好 MDict 词典目录（包含 `.mdx` 文件，可选 `.mdd` 资源文件）
2. 打开 **设置 → 词典管理**，点击「导入词典」，选择词典所在目录
3. 导入完成后词典自动启用，搜索框即可使用

---

## 本地开发

### macOS 应用（`macos/`）

**依赖：** Node.js 18+、Rust 1.77+、Tauri CLI 2.x

```bash
cd macos

# 安装前端依赖
npm install

# 启动开发模式（Vite + Rust 后端同时启动）
npm run tauri dev

# TypeScript 类型检查
npx tsc --noEmit

# 仅编译 Rust 后端
cargo build --manifest-path src-tauri/Cargo.toml

# 生产构建
npm run tauri build
```

### iOS 应用（`ios/`）

**依赖：** Xcode 15+、iOS 17 Simulator

```bash
# 在 Xcode 中打开
open ios/GleanIOS.xcodeproj

# 运行 MdxKit 单元测试
cd ios/MdxKit && swift test

# 重新生成 Xcode 项目（修改 project.yml 后）
cd ios && xcodegen generate
```

---

## 技术栈

### macOS
| 层级 | 技术 |
|------|------|
| 前端 | React 19 + TypeScript 6 + Vite 8 + Tailwind CSS 4 + shadcn/ui |
| 后端 | Rust + Tauri 2.x |
| 数据库 | SQLite（rusqlite，本地存储） |
| 状态管理 | Zustand |
| MDX/MDD 解析 | 自实现 Rust 解析器（MDX 2.0、zlib、RIPEMD-128、MDD 二进制） |
| 图表 | Recharts |

### iOS
| 层级 | 技术 |
|------|------|
| UI | SwiftUI（iOS 17+）+ `@Observable` |
| 数据库 | GRDB.swift 6.x（schema 与 macOS 版一致） |
| MDX/MDD 解析 | MdxKit Swift Package（自实现，RIPEMD-128 + zlib + MDD） |
| 渲染 | WKWebView + CSS 内联注入，per-dict 独立滚动 |

---

## 数据目录

应用数据存储在 `~/.glean/`：

```
~/.glean/
├── glean.db          # 主数据库（生词本、查询历史）
└── dicts/            # 词典文件
    └── <id>/         # 每本词典独立目录（id = SHA256(词典名)[:8]）
        ├── *.mdx
        ├── *.mdd
        └── *.css
```

---

## 版本历史

### v0.6.1
- **AI 解释**：查不到本地词典时也显示 AI 解释入口
- **AI 请求竞态修复**：切词或跳页时自动丢弃进行中的旧请求，防止结果写入错误的单词面板

### v0.6.0
- **在线查词 fallback** — 本地词典无结果时自动调用 Free Dictionary API（可在设置中开关）
- **AI 解释** — 词典结果面板新增「AI 解释」按钮，支持 DeepSeek / OpenAI / Ollama 等 OpenAI 兼容 API
- 设置页新增「在线查词」与「AI 解释」配置区，API Key 持久化存储到本地 SQLite

### v0.5.0
- **iOS 原生应用**：首个可用版本，支持 MDX+MDD 词典解析、实时前缀搜索、多词典并排查阅（WKWebView + CSS 注入）
- **iOS MdxKit**：Swift Package 完整实现 MDX 2.0 + MDD 二进制资源解析，包含 RIPEMD-128 自实现与 zlib 解压
- **iOS 词典排序**：读取 macOS `glean.db` 的 `sort_order`，与 macOS 端保持一致
- **monorepo 重构**：macOS 应用移至 `macos/`，iOS 应用移至 `ios/`，单一 git 仓库管理

### v0.4.0
- **背单词**：SM-2 间隔重复算法，每次最多 20 词（优先到期词，不足时以最新生词补充），四档评分，翻牌显示完整词典原文
- Markdown 导出重构：平铺格式 `word  #tag1 #tag2`，原生 Save 对话框自由选择路径与文件名
- 依赖全面升级：React 19、TypeScript 6、Vite 8、Tailwind CSS 4（CSS-first 配置）、ESLint 10

### v0.3.7
- 整体配色重构：采用 Flexoki Light 纸墨风，暖白纸底色配深蓝主色，替换原莫兰迪绿书卷风
- 字体体系重构：霞鹜文楷用于中文 Slogan，Cormorant Garamond 用于英文展示，思源宋体用于中文标题
- 关于页重设计：图标左置 + 双语名称右侧居中，中英 Slogan 横线排版，版本号动态读取
- Logo 无边框化：全局 `mix-blend-mode: multiply`，图标直接融入暖纸背景，去除白底卡片与描边

### v0.3.6
- 查词历史导航：搜索框左侧新增前进/后退按钮，会话内浏览器式栈导航，查过的单词可一键回溯

### v0.3.5
- 生词本单词列表移除 tag 标签显示，保持列表简洁
- 生词笔记功能：选中单词后右侧可折叠笔记栏，支持编辑与手动保存
- 笔记预览：列表中有笔记的单词名下显示一行灰色摘要
- 「有笔记」筛选：可与标签筛选叠加，仅显示有笔记的单词
- 移除星级（1-5）评分机制，简化生词管理
- 移除 `level` 数据库字段，清理相关代码
- 候选词列表字体优化：优先使用系统字体（`-apple-system`），添加字间距提升清晰度
- 生词本虚拟列表行距与候选词列表对齐，支持动态行高

### v0.3.0
- 生词本页面重构：横向标签过滤条 + 双栏布局（词典详情与主界面统一）
- 标签管理优化：默认标签星形标识（常显）、border 加深凸显、hover 显示 Star/删除操作
- MDD 索引缓存版本控制，防止旧缓存导致资源加载异常
- 查询历史改为分组标题展示，近期记录扩展至 50 条
- 切换至生词本自动清空搜索框与词典详情面板
- 未收藏单词不预选标签；收藏后同步实际标签状态
- 收藏按钮行为优化：未选标签时自动归入默认标签组

### v0.2.0
- 整合自定义 Logo（全尺寸 `icns` / `ico` / PNG）
- `@@@LINK=` 别名重定向自动跟随
- 候选列表过滤数字别名词条（`dream_1` 等）
- 候选列表词典子目录，支持词典图标 / 首字母头像
- `/` 快捷键聚焦搜索框
- Navbar Logo 重设计（图标卡片 + 双行文字）

### v0.1.0
- MDict（MDX + MDD）解析引擎
- 实时前缀检索、多词典并排结果
- Shadow DOM 样式隔离、`mdd://` 资源协议
- 词典内音频播放、系统 TTS 降级
- 生词本、标签、备注、Markdown 导出
- 查询统计与趋势图

---

## License

MIT
