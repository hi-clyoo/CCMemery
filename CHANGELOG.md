# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
