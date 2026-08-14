# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] — 2026-08-14

### Added
- **索引（Index）分类**：把 CLAUDE.md / MEMORY.md 引用的 Markdown 文件做成反向索引，按「来源文件」分组；识别 markdown 链接、反引号路径、裸路径与远程 URL 四种引用写法。
- **git 状态图标**：每个文件行和查看器标题栏显示真实 git 状态（已提交 / 已修改 / 已暂存 / 未跟踪），由 `git status --porcelain` 解析。
- **跳转高亮**：从索引分类点击「索引来源」跳回源文件时，高亮引用所在行并滚动到居中位置。
- **手动刷新按钮**：一键重载项目列表、会话与文件（新增项目目录 / 新会话 / CLAUDE.md 改动无需重启或重选）。

### Changed
- 打开文件 / 会话 / 项目时自动关闭「加载规则」说明面板。
- 默认主题改为**亮色**、默认语言改为**中文**（已保存的偏好仍优先）。

## [0.1.0] — 2026-08-11

First public release of CC Memory — a visual manager for Claude Code memory files.

### Added
- Visual memory file manager: browse all Claude Code projects (current & historical), view/edit `CLAUDE.md` and memory files, inspect raw session JSONL.
- Five memory file categories with per-file editing and a collapsible loading-rule summary: **Managed / User / Project / Local / Memory**.
- Bilingual UI (**中文 / English**) with a persisted language toggle; loading-rule descriptions are localized.
- Cross-platform dark / light theme toggle (macOS, Windows, Linux) backed by a shared `useTheme` hook.
- About panel documenting how each CLAUDE.md file type is loaded (path, priority, merge rules) and showing the app version.
- GitHub Actions CI (typecheck / lint / test / build) and an automated multi-platform release workflow.

### Fixed
- macOS hidden title bar: reserved space for native traffic lights so the title row no longer overlaps the window controls.
- macOS Dock icon not matching the project's SVG artwork (regenerated `icon.icns`).
- Release workflow still referenced the old `claude-devtools.app` binary name.
- CI triggered only on the `main` branch while the default branch is `master`.

### Changed
- Removed inherited `claude-devtools` changelog history and release links; the project now documents its own history.
- macOS installers build unsigned for now (no Apple Developer signing/notarization); Gatekeeper may warn on first launch.
