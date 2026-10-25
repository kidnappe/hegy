# 开发指南

本文写给准备改代码的人。用户向的安装和使用说明见 [README](../README.md)。

---

## 1. 环境

| 需求 | 说明 |
|---|---|
| Node.js | 18+（开发机验证 v22） |
| 浏览器 | Edge / Chrome（应用本身支持现代浏览器） |
| 模型服务 | 任意 OpenAI 兼容接口；不配置也可以用 `solver/mock.js` 联调 |
| 桌面打包 | 额外需要 npm；首次 `npm install` 会下载 Electron |

根目录**没有** `package.json` 依赖，也没有打包步骤。`npm test` 只跑基础自检。

---

## 2. 本地运行

```bash
# 终端 1：应用服务
node solver/serve.js 8099

# 终端 2（可选）：mock 模型
node solver/mock.js
```

打开 `http://127.0.0.1:8099/`。

Mock 配置：

```json
{
  "baseUrl": "http://127.0.0.1:8098/v1",
  "apiKey": "mock",
  "model": "mock",
  "temperature": 0.2
}
```

> 端口约定：应用 `8099`、mock `8098`、Electron `17321`。测试脚本使用 `9400+`，不要并发跑。

---

## 3. 目录与职责

```text
solver/
  index.html      页面骨架。ID 是 solver.js 的查询契约，改名会静默断功能。
  ui.js           UI 层：布局、对象面板、步骤条、设置、历史、弹窗。
  ui.css          界面样式与主题变量。
  solver.js       核心流程：提交、SSE、渲染、导出、微调、版本、拖入导入。
  serve.js        Node 适配层：静态文件、/api/*、SSE、记录落盘、配置读写、模型调用与结果校验。
  geometry.js     自研几何计算库，挂 window.HexMath。
  shim.js         把 GGBBoard / GGBMath 映射到 JSXGraph / HexMath。
  prompt.txt      系统提示词正文（按 @module / @rules 分段）。
  chat-prompt.txt 追问提示词。
  prompt-rules.md 提示词规则索引与预算表。
  mock.js         Mock 模型服务。
  vendor/         JSXGraph、KaTeX、Lucide（第三方，保留版权头）。
  vendor3d/       three.js、OrbitControls、render3d.js（3D 渲染内核）。

desktop/          Electron 外壳 + electron-builder 配置。

tools/            Windows + Edge 的测试 / 截图脚本。
docs/             开发文档、发布清单、截图。
```

---

## 4. 请求链路

```text
solver.js
  └─ POST /api/solve { question, images, grade, dim, config, stream }
       └─ serve.js
            ├─ buildSolvePayload()        拼提示词 / 图片 / few-shot
            ├─ 调 OpenAI 兼容接口
            ├─ parseModelJson()           解析
            ├─ validateResult()           校验 renderCode / render3d
            ├─ normalizeResult()          白名单归一化
            └─ 落盘记录（meta + body）
  └─ SSE /api/task/:id/events
       └─ 前端 settle() → 渲染 / 历史 / 错误
```

### 任务与 SSE

- 任务状态在内存里维护，15 分钟 TTL；超过 400 个任务时才顺带清扫。
- 前端 SSE 断开后回落轮询 `/api/task/:id`。
- 刷新页面可以恢复未完成任务（任务 ID 存在前端状态里）。
- 同一页面最多 6 个进行中任务。

### 错误口径

错误分类、用户可见文案、日志脱敏都在 `serve.js`。日志只记录 `baseUrl` 的 origin，不记录 API Key。

---

## 5. 提示词与渲染契约

### 提示词

- `solver/prompt.txt` 是唯一正文；`prompt-rules.md` 只是索引。
- `<!-- @module:... -->` 决定模块归属，`<!-- @rules:... -->` 列出规则 ID。
- 服务端拼请求前会剥掉 HTML 注释，标记不占 token。
- 改提示词后跑：

```bash
node tools/check_prompt.js
node tools/check_prompt_content.js
```

> 这两个脚本属于提示词专项检查；如果它们与当前结构不一致，以 `prompt-rules.md` 和 `serve.js` 为准并顺手修脚本。

### 2D 渲染

模型返回 `renderCode`，在浏览器里执行。可用全局名：

- `GGBBoard.init(id, options)`：创建 JSXGraph 画板；
- `GGBMath.*`：几何计算函数（`geometry.js`）。

**这些名字是对外契约**，存量记录和导出 HTML 都在用，不能改名。真正的实现可以在 `shim.js` 里替换。

### 3D 渲染

模型返回 `render3d`（JSON 场景），由 `vendor3d/render3d.js` 解释。3D 分步、对象显隐、坐标轴、网格都在这一层。

### 导出

离线 HTML 由 `solver.js` 的导出段生成，内嵌：

- JSXGraph / KaTeX / 字体；
- 答案、解析、分步、对象显隐；
- `HJ_REC` 原始记录（可拖回应用还原）。

改导出逻辑时，重点回归 2D / 3D、多小问、多版本，以及"导出的 HTML 再拖回应用"。

---

## 6. 数据存储

| 内容 | 位置 |
|---|---|
| 模型配置 | `~/.hegy/settings.json` |
| 解题记录 | `Documents/Hegy/records/` |
| 记录索引 | 无（目录 + meta 首行） |
| 日志 | `~/.hegy/logs/`（如启用） |

一条记录是一个 `<id>.json`，两行 JSONL：首行 meta，次行 body。

**不要把真实记录、`settings.json`、`config.json` 提交到仓库。**

---

## 7. 测试

### 基础自检（跨平台）

```bash
npm test
# 等价于 node tools/verify.js
```

检查：

- Node 版本；
- 关键文件是否存在；
- 核心 JS 语法；
- KaTeX 字体数量；
- `shim` / 导出模板的关键契约；
- 本地配置是否误入工作区。

### 浏览器回归（Windows + Edge）

`tools/` 下的脚本通过 CDP 驱动无头 Edge，覆盖解题、导出、对象面板、版本、微调等。它们：

- 假设 Edge 安装在 `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`；
- 使用 `9400+` 端口；
- 部分脚本使用系统临时目录（`os.tmpdir()`）下的固定子目录；
- 跑之前需要先启动 `serve.js` 和 `mock.js`。

详见 [`tools/README.md`](../tools/README.md)。跑涉及真实配置的脚本时，用 `tools/run_with_cfg_guard.js` 包一层，避免覆盖 `~/.hegy/settings.json`。

网格渲染演示页：[`docs/grid-demo.html`](grid-demo.html)。启动本地服务后访问 `http://127.0.0.1:8099/docs/grid-demo.html`。

### CI

GitHub Actions 只跑 `npm test`（不启动浏览器、不访问模型）。UI 回归仍以本地手动 / 脚本为准。

---

## 8. 桌面打包

```bash
cd desktop
npm install
npm start              # 开发态
npm run dist           # 便携版（x64）
npm run dist:arm64     # 便携版（ARM64）
```

要点：

- `desktop/main.js` 启动内置 `solver/serve.js`，端口 `17321`。
- 便携版把 Electron 用户数据放到 exe 同目录 `HegyData/`。
- `desktop/package.json` 的 `build.files` 会把 `solver/` 打进包，并排除 `example_*`、`mock.js`、`config.json`、测试脚本等。
- 根 `LICENSE` 通过 `build.extraResources` 复制到 `resources/app/LICENSE`，保证桌面版导出页能内嵌 AGPL 全文。
- 桌面版使用 Electron 26.6.10；安装 `desktop/` 依赖需要 Node.js 18+（应用本体同样支持）。
- 打包脚本 `desktop/tools/patch-portable-nsis.js` 针对 electron-builder 24.13.3 的 `portable.nsi` 模板做幂等修补；升级 electron-builder 后先确认这两个上游问题是否已修复。

---

## 9. 常见问题

### 页面一片空白

1. 打开浏览器控制台看 404 / 语法错误；
2. 确认 `solver/vendor/jsxgraph.js` 在 `shim.js` 之前加载。

### 修改后刷新没生效

- `serve.js` 是静态文件服务，通常刷新即可；如果改了提示词，服务端每次请求会重新读文件，不需要重启。
- 改了 `serve.js` 需要重启 Node 进程。
- 浏览器缓存：看 Network 面板的 `?v=` 参数。

### 中文乱码

所有源码是 UTF-8。PowerShell 里用：

```powershell
Get-Content -Encoding UTF8 file.js
```

或先 `chcp 65001`。

### 公式排版异常

`mathHTML()` 会剥掉 KaTeX 的 MathML 层并压平换行。不要在公式容器上使用 `white-space: pre-wrap`，否则每个字符都会成为换行点。

### 历史记录删不掉 / 又出现

先比对磁盘文件数和 `/api/store/index` 的条目数，再检查是否有云盘冲突副本或别的进程在写。

### 测试脚本覆盖了真实配置

用 `tools/run_with_cfg_guard.js` 包一层：

```bash
node tools/run_with_cfg_guard.js tools/versions_test.js
```

它会备份并在退出时恢复 `~/.hegy/settings.json`。

---

## 10. 代码风格

- 原生 JS，不引入框架、不引入构建步骤。
- 现有核心文件使用 IIFE + `var` + 2 空格缩进；新代码保持同样风格，避免混入 ESM。
- 字符串、注释、提示词全部 UTF-8。
- 不随意改 `solver/index.html` 的 ID；它们是 `solver.js` 的查询契约。
- 不随意改 `GGBBoard` / `GGBMath` 的全局名；存量记录和导出文件依赖它们。
- 新增模型返回字段时，先改 `serve.js` 的归一化白名单，再改前端。

---

## 11. 公开仓库边界

公开仓库只包含应用源码、必要文档和测试工具。以下内容不应提交：

- 内部交接 / 排障记录；
- `video-intro/`、`video-kit/` 等大体积视频素材；
- `_backup/`、`_check/`、`.tmp/`、`poster/`、`demo/`；
- `node_modules/`、`desktop/dist/`；
- `solver/config.json`、`.env`、用户记录、导出 HTML、截图产物。

维护者发布前请按 [`RELEASING.md`](RELEASING.md) 的清单检查。

---

## 12. 许可证

项目采用 **AGPL-3.0-only**，完整条款见根目录 [`LICENSE`](../LICENSE)。提交贡献即表示同意以该许可发布；引入第三方代码、字体或素材时，请同步更新 [`solver/vendor/LICENSES.md`](../solver/vendor/LICENSES.md)。
