# CC Memory

Claude Code 记忆文件管理器 —— 可视化查看、编辑和管理 Claude Code 的记忆文件。

## 功能

- 浏览所有 Claude Code 项目（当前及历史）
- 查看各类型的记忆文件（Managed / User / Project / Local / Memory）
- 在线编辑 CLAUDE.md 和 Memory 文件
- 查看 Session 原始 JSONL 数据
- 记忆文件加载规则说明
- 支持 Windows / macOS / Linux

## 技术栈

Electron + React + TypeScript + CodeMirror 6 + Tailwind CSS

## 开发

```bash
pnpm install
pnpm dev      # 启动开发服务器（端口 9015）
pnpm build    # 生产构建
pnpm typecheck # 类型检查
```

## License

MIT
