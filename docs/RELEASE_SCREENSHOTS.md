# 发布与截图指南

面向 CC Memory 的发布与截图操作流程，团队可复用。

## 发布流程

1. **版本号三处同步**：`package.json` / `README.md`（版本徽章、下载表、`git tag vX` 示例）/ `CHANGELOG.md`（Keep a Changelog 格式）。
2. **提交并打 tag**：`git tag vX.Y.Z && git push origin vX.Y.Z`。
3. **CI 自动构建**：GitHub Actions `release.yml` 针对 `v*` tag 构建 macOS（arm64 + x64）/ Windows / Linux 安装包，并创建 **draft** release（无需本地打包）。
4. **发布草稿并更新正文**（需 GitHub 认证，例如 PAT 或 `gh`）：
   - 列出 release 拿 id：`GET /repos/{owner}/{repo}/releases`（含草稿）。
   - 更新并发布：`PATCH /repos/{owner}/{repo}/releases/{id}`，设置 `draft:false` 并写入 `body`。
   - 正文里的截图使用 `https://raw.githubusercontent.com/{owner}/{repo}/master/...` **直链**（`github.com/.../raw` 重定向对个别文件会返回 500）。

## 截图指南

用**真实 Electron 渲染**截图（不要用 html2canvas / headless 浏览器，渲染会错乱）。

1. 启动带 CDP 的应用：`pnpm dev -- --remote-debugging-port=9222`（先结束旧实例，存在单实例锁）。
2. `curl http://127.0.0.1:9222/json` 拿页面 target 的 WebSocket URL。
3. 用 Node（内置 `WebSocket`）连 CDP：
   - `Runtime.evaluate` → 点击项目/文件、切换主题、切换语言、打开面板、展开并选择会话。
   - `Emulation.setDeviceMetricsOverride` → 设置视口（如 1400×900；默认渲染视口可能偏窄）。
   - `Page.captureScreenshot` → 保存真实渲染 PNG。
4. **内容区必须打码再公开**：发布前用 PIL `GaussianBlur` 模糊编辑器正文/会话内容区，防止泄露真实数据。
   - 先用 OCR 坐标定位内容区（不同项目/文件布局不同）。
   - hero 类：只模糊编辑器正文（x ≥ 0.40，y 从文件头栏下方开始），保留索引说明区与来源 chip。
   - session-jsonl 类：模糊右栏 JSONL 内容 + 标题栏 + 左侧会话行。
5. 验证：OCR 确认内容与语言、PIL 亮度判断亮/暗主题、OCR 坐标确认打码是否遗漏。

## 已知坑

| 方法 | 结果 |
|------|------|
| html2canvas 浏览器截图 | 布局 / CodeMirror 渲染错乱 |
| headless Chrome `--screenshot` | 旧版 Chrome 在部分 macOS 崩溃 |
| Safari 打开 localhost 截图 | 页面空白 |
| System Events / CGEvent 点击 | 无辅助功能权限时被拒 |

## 项目注意

- app 里的项目路径 = 会话 cwd（可能解析到仓库的父目录）。
- electron-builder 使用动态 `${version}` 生成安装包名。
