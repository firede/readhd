# ReadHD 阅读助手

一个 Chrome/Edge 扩展，帮助有阅读困难的小学生更轻松地阅读中文网页：

- 给词语交替标色（可按“词”或“意群”标色），浅色/深色背景自动适配
- 可选淡化虚词（的、了、吗…）
- 阅读尺：跟随鼠标遮住上下文，只露出当前几行
- 可调行距、字间距、字号、页面底色
- 分词/词性/意群分析可用云端模型（MiniMax，Anthropic 兼容接口），未配置 Key 时自动退回本地 `Intl.Segmenter`

## 开发

- 开发调试：`pnpm dev`（云端分析需在环境变量中提供 `MINIMAX_API_KEY`）
- 构建：`pnpm build` → `.output/chrome-mv3/`
- 单元测试：`pnpm test`
- 类型检查：`pnpm compile`
- 端到端冒烟：`node scripts/e2e.mjs [--dev]`
