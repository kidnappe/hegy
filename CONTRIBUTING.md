# 贡献指南

感谢你愿意帮「何解」变得更好。这个项目是一个本地优先的 AI 几何解题器，代码量不大，但涉及提示词、2D/3D 渲染、导出和桌面壳。开始之前请先读一下这份指南。

---

## 先讨论，再动手

- **Bug / 小改动**：可以直接开 PR，但请在描述里写清楚复现步骤。
- **新功能 / 大重构 / 改提示词结构**：先开 Issue 说明动机、方案和影响范围，避免做完才发现方向不一致。
- **安全漏洞**：不要开公开 Issue，按 [SECURITY.md](SECURITY.md) 私密报告。

---

## 本地开发

```bash
node solver/serve.js 8099
# 另开终端
node solver/mock.js
```

打开 `http://127.0.0.1:8099/`。不需要安装根目录依赖。

提交前至少跑一遍：

```bash
npm test
```

涉及 UI / 渲染 / 导出的改动，请再在浏览器里手动验证，并在 PR 里附截图或说明验证方式。

---

## 代码约定

- **原生 JS，不引入框架和构建步骤。** 这是项目的刻意选择，方便本地运行和离线导出。
- 保持现有风格：IIFE、`var`、2 空格缩进、UTF-8、分号。
- 不要随意改 `solver/index.html` 里的 ID；`solver.js` 依赖它们。
- 不要改 `GGBBoard` / `GGBMath` 这两个全局名；存量记录和导出的离线 HTML 依赖它们。
- 新增模型返回字段时，先在 `serve.js` 的归一化白名单里放行，再改前端。
- 错误文案尽量保持「一句话 + 可操作建议」，不要在 UI 里直接抛原始异常。

---

## 提示词与绘图 DSL

改 `solver/prompt.txt`、`chat-prompt.txt` 或 `prompt-rules.md` 时：

1. 保持 `<!-- @module:... -->` / `<!-- @rules:... -->` 标记完整；
2. 同步更新 `prompt-rules.md` 的模块和预算；
3. 跑提示词检查脚本；
4. 至少用 mock 或真实模型跑一道 2D、一道 3D；
5. 如果改了 `renderCode` / `render3d` 的契约，说明兼容性影响。

---

## 不要提交的内容

- API Key、`solver/config.json`、`.env`、`*.local.json`
- `~/.hegy/settings.json`、用户解题记录、导出的 HTML
- `node_modules/`、`desktop/dist/`
- `_backup/`、`.tmp/`、`poster/`、`video-intro/`、`video-kit/`、`demo/`
- 大体积截图 / 视频素材（文档截图放 `docs/screenshots/`，并控制体积）

如果不确定，先看 `.gitignore` 和 [docs/RELEASING.md](docs/RELEASING.md)。

---

## 提交信息

使用 Conventional Commits 风格，中英文都可以：

```text
feat: 支持 3D 分步播放
fix: 修复导出 HTML 在手机上的横向溢出
docs: 补充桌面构建说明
refactor: 把配置读写收敛到 serve.js
test: 补 2D 导出回归
chore: 更新第三方许可说明
```

一个提交只做一件事；格式化、重命名和功能改动尽量分开。

---

## PR 检查清单

- [ ] 说明改动动机和影响范围
- [ ] `npm test` 通过
- [ ] 涉及 UI / 渲染的改动附截图或录屏
- [ ] 涉及导出的改动验证了 2D / 3D 和桌面宽度
- [ ] 没有提交密钥、记录、构建产物或大体积素材
- [ ] 新增/修改的提示词规则已同步 `prompt-rules.md`
- [ ] 如改了 `/api/*`，同步检查 `serve.js` 与前端调用方
- [ ] 如引入第三方代码 / 字体 / 素材，已更新 `solver/vendor/LICENSES.md` 并确认许可兼容

---

## 许可证

本项目采用 **AGPL-3.0-only**，完整条款见根目录 [`LICENSE`](LICENSE)。

提交 PR 即表示你同意该贡献以 AGPL-3.0-only 授权给本项目及其他使用者。引入第三方代码、字体或素材时，请同时更新 [`solver/vendor/LICENSES.md`](solver/vendor/LICENSES.md)，并确认其许可与 AGPL-3.0 兼容。

---

## 行为准则

参与本项目即表示你同意遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。
