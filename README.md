# 何解 · Hegy

> 本地运行的 AI 动态几何解题器：贴一道题，得到一个**可以拖动、可以旋转、可以分步看**的图形。

<p align="center">
  <img src="docs/screenshots/2d-solve.png" alt="何解 2D 解题界面" width="100%" />
</p>

何解把「题目 → 大模型 → 图形」这条链路做成了一个完整的本地应用：

- 输入文字题，或直接粘贴 / 拖入题目截图；
- 调用任意 **OpenAI 兼容**接口，让模型返回可执行的 2D / 3D 绘图脚本；
- 在浏览器里用 JSXGraph / three.js 渲染出可交互图形，右侧同步给出答案与分步解析；
- 支持微调、多版本、历史记录，以及导出**单文件离线 HTML**。

项目没有前端构建步骤：改完 `solver/*.js` 刷新页面即可生效。日常开发只需要 Node.js。

---

## 目录

- [功能](#功能)
- [快速开始](#快速开始)
- [配置模型](#配置模型)
- [桌面版](#桌面版)
- [Android 手机版（实验）](#android-手机版实验)
- [项目结构](#项目结构)
- [工作原理](#工作原理)
- [数据与隐私](#数据与隐私)
- [开发与测试](#开发与测试)
- [已知限制](#已知限制)
- [参与贡献](#参与贡献)
- [许可证](#许可证)
- [第三方组件](#第三方组件)

---

## 功能

### 输入与解题

- **文字题**：最多 1000 字，`Ctrl+Enter` 直接提交。
- **图片题**：支持粘贴截图、拖入图片、多图上传；可在提交前重新裁剪题图。
- **按年级作答**：不指定 / 初一至高三，按对应学段的知识范围回答。
- **图形类型**：自动 / 平面 2D / 立体 3D，也可以交给模型判断。
- **异步任务**：提交后立即返回，页面不阻塞；支持进度、取消、刷新后恢复。
- **结果校验**：服务端校验模型返回的 JSON 与绘图脚本；失败时自动让模型修正。

### 图形与讲解

- **2D 画布**：拖点、拖对象、滚轮缩放、拖拽平移、键盘微调。
- **3D 画布**：拖动旋转、滚轮缩放、坐标轴、平面与立体对象。
- **对象面板**：按点 / 线 / 面筛选，实时显示坐标、长度、面积、角度等。
- **测量卡**：关键量实时刷新。
- **步骤条**：分步播放，步骤说明支持公式。
- **答案与解析**：KaTeX 渲染，支持多小问切换、定位到图上对象。
- **微调**：自然语言改图形 / 改解析 / 换图形类型，支持审查后保留或撤销。
- **历史记录**：一条记录一个本地 JSON 文件，可回看、导入、导出。
- **离线导出**：单文件 HTML，内嵌图形引擎、公式字体、答案与解析，双击即开。

### 运行形态

- **浏览器**：`node solver/serve.js` 起本地服务即可。
- **Windows 桌面版**：Electron 外壳 + electron-builder，便携版。
- **Android 手机版**（实验）：Capacitor 外壳，复用同一套 `solver/` 前端。
- **夜间模式**：界面支持日间 / 夜间切换。

<p align="center">
  <img src="docs/screenshots/3d-solve.png" alt="3D 解题界面" width="49%" />
  <img src="docs/screenshots/dark-3d.png" alt="夜间模式" width="49%" />
</p>

---

## 快速开始

### 环境

- **Node.js 18+**（开发时使用 v22 验证）
- 一个 OpenAI 兼容的模型服务，例如 DeepSeek、OpenAI、通义、智谱、Kimi 等
- 可选：Edge / Chrome（测试脚本与截图工具使用）

不需要 `npm install`，根目录也没有构建步骤。

### 跑起来

```bash
git clone https://github.com/kidnappe/hegy.git hegy
cd hegy

# 启动本地服务（默认 8099）
node solver/serve.js 8099
```

浏览器打开：

```text
http://127.0.0.1:8099/
```

服务会自动跳到 `solver/index.html`。第一次打开时右上角会显示「未配置模型」，点它填入接口信息即可。

### Mock 模式（不消耗 token）

另开一个终端：

```bash
node solver/mock.js
```

然后在「设置」里填：

| 字段 | 值 |
|---|---|
| Base URL | `http://127.0.0.1:8098/v1` |
| API Key | `mock` |
| Model | `mock` |

Mock 服务会根据题目关键词返回固定的 2D / 3D 场景，适合调 UI 和跑测试。

---

## 配置模型

何解只要求接口兼容 OpenAI 的 `POST /chat/completions`，不绑定具体厂商。

在应用内打开「设置 → 模型」，填写：

- **Base URL**：例如 `https://api.deepseek.com/v1`
- **API Key**
- **模型名**：可以手动输入，也可以点「获取列表」从接口拉取
- **温度**：默认 `0.2`

配置会保存到：

| 平台 | 位置 |
|---|---|
| 桌面 / 浏览器 | `~/.hegy/settings.json` |

`solver/config.example.json` 是一份服务端配置样例。**不要**把真实 Key 写进仓库；`solver/config.json`、`.env`、`*.local.json` 已被忽略。

---

## 桌面版

```bash
cd desktop
npm install
npm start          # 开发态启动 Electron
npm run dist       # Windows 便携版
npm run dist:arm64 # Windows ARM64 便携版
```

产物在 `desktop/dist/`（已忽略，不会进仓库）。

> 桌面版使用 Electron 26.6（Chromium 116）；安装桌面依赖需要 Node.js 18+。应用本体（`solver/`）同样在 Node.js 18+ 运行。

桌面版内建服务固定使用端口 `17321`，开发态使用 `8099`，mock 使用 `8098`。便携版会把 Electron 用户数据放在 exe 同目录的 `HegyData/`。

> 当前 electron-builder 配置面向 Windows x64 / ARM64；macOS / Linux 需要自行调整 `desktop/package.json` 的 `build` 段。

---

## Android 手机版（实验）

手机端是一个 Capacitor 壳，把同一份 `solver/` 前端装进 Android WebView，界面按手机重排（半屏浮层、步骤条、底部输入）。

```bash
cd mobile
npm install
node tools/prepare.js            # solver + src → www
npx cap copy android             # 复制到 android/app/src/main/assets/public
cd android && ./gradlew.bat assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

- 目前是 **debug 包**（自签名、可侧载），未上架应用商店；架构与构建细节见 [`mobile/ARCH.md`](mobile/ARCH.md)。
- 已知限制：非流式请求（没有 SSE 增量），长题推理期间只有阶段提示；后台被杀后任务需要手动重试。
- 模型配置在手机端单独填写（设置 → 模型），与桌面版 `~/.hegy/settings.json` 不共用。

---

## 项目结构

```text
solver/                应用本体（浏览器端 + 本地 Node 服务）
  index.html           页面骨架（大量旧 ID 是兼容契约，勿随意改名）
  ui.js / ui.css       界面、布局、对象面板、步骤条、设置
  solver.js            解题流程、渲染、导出、历史、微调
  serve.js             本地服务：静态文件 + /api/* + SSE + 记录落盘
  geometry.js          自研几何计算库（window.HexMath）
  shim.js              兼容层（GGBBoard → JSXGraph，GGBMath → HexMath）
  prompt.txt           系统提示词（绘图 DSL 规范）
  chat-prompt.txt      追问提示词
  mock.js              Mock 模型服务（8098）
  vendor/              JSXGraph / KaTeX / Lucide
  vendor3d/            three.js / OrbitControls / 3D 渲染内核

desktop/               Electron 外壳与 electron-builder 配置
mobile/                Android 壳（Capacitor）：src/ 手机界面 + android/ 工程
docs/                  开发文档、截图
tools/                 Windows + Edge 的测试 / 截图脚本（见 tools/README.md）

STYLE.md               产品功能地图与界面风格说明
```

---

## 工作原理

```text
浏览器
  │  POST /api/solve
  ▼
solver/serve.js
  │  1. 组装系统提示词 + 题目 + 图片
  │  2. 调用 OpenAI 兼容接口
  │  3. 校验 / 归一化模型返回
  ▼
前端
  │  4. 执行 renderCode（JSXGraph）或 render3d（three.js）
  │  5. 渲染答案、解析、分步、对象面板
  ▼
本地记录（Documents/Hegy/records）
```

几个关键约定：

- 模型返回的是**可执行绘图脚本**，不是图片；图形因此可以拖动、缩放、分步高亮。
- `renderCode` 里的全局名 `GGBBoard` / `GGBMath` 是历史契约，不能随意改名；它们由 `shim.js` 映射到 JSXGraph 和自研 `geometry.js`。
- 服务端只把模型返回中白名单内的字段交给前端；新增字段需要同时改 `serve.js` 的归一化逻辑。

更细的架构、端口、调试和踩坑记录见 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)。

---

## 数据与隐私

- **没有遥测、没有账号体系**。应用只向你配置的模型服务发送题目文本与图片。
- API Key 保存在本机用户目录，不写入项目文件。
- 解题记录默认保存在 `Documents/Hegy/records/`。
- 导出 HTML 是单文件离线文件，不依赖何解服务；其中的内容可以被任何拿到文件的人查看，分享前请自行检查。
- 如果你要提交 Issue，请先删掉 API Key、完整记录、题目截图中的个人信息。

---

## 开发与测试

```bash
npm test          # 基础自检：文件完整性 + JS 语法 + 渲染/导出契约
```

`tools/verify.js` 不启动服务，也不访问模型，适合提交前跑一遍。

完整的浏览器回归脚本在 `tools/`，它们依赖 Windows + Edge + CDP，部分脚本使用固定端口和本地路径。运行前请先读 [`tools/README.md`](tools/README.md)。

开发约定：

- 原生 JS，不引入框架和构建步骤；
- 新增代码保持现有风格（IIFE / `var` / 2 空格 / UTF-8）；
- 改提示词或绘图 DSL 时，必须同步更新 `solver/prompt-rules.md` 与相关测试；
- 不要提交 `node_modules/`、`dist/`、`solver/config.json`、记录文件或导出物。

---

## 已知限制

- AI 生成的答案和图形都可能出错；请把它当作辅助工具，而不是标准答案。
- 桌面打包面向 Windows x64 / ARM64；macOS / Linux 未配置，需要自行调整 `desktop/package.json`。
- 测试 / 截图脚本以 Windows + Edge 为主，跨平台支持还不完整。
- 便携版约 90MB、安装版约 65MB（Electron 26.6.10）；体积和冷启动耗时随 Electron 版本变化，升级后需重新实测。

---

## 参与贡献

欢迎 Issue 和 PR。开始之前请读：

- [`CONTRIBUTING.md`](CONTRIBUTING.md)
- [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)
- [`SECURITY.md`](SECURITY.md)

提交 PR 时请尽量做到：

1. 一个 PR 只做一件事；
2. 说明改动动机、验证方式和影响范围；
3. 涉及 UI 的改动附上截图；
4. 不提交密钥、用户记录、构建产物和大体积素材。

---

## 许可证

Copyright (C) 2026 zhouxuan and Hegy contributors.

本项目采用 **GNU Affero General Public License v3.0 only（AGPL-3.0-only）**。

- 你可以自由使用、修改、分发，包括商业使用；
- 分发修改版时必须保留版权声明，并以 AGPL-3.0 授权；
- **如果你修改后把它作为网络服务提供给他人使用，必须向这些用户提供对应的完整源码**（AGPL 第 13 条）。

完整条款见根目录 [`LICENSE`](LICENSE)。如果你只是在自己电脑上使用，通常不产生额外义务；涉及商业分发或对外提供服务前，请自行确认合规。

---

## 第三方组件

| 组件 | 版本 | 许可证 |
|---|---|---|
| [JSXGraph](https://jsxgraph.org/) | 1.12.2 | LGPL-3.0 或 MIT（本项目按 MIT 使用） |
| [KaTeX](https://katex.org/) | 0.19.0 | MIT |
| [three.js](https://threejs.org/) | r128 | MIT |
| [OrbitControls](https://threejs.org/) | r128 | MIT |
| [Lucide](https://lucide.dev/) | 1.59.0 | ISC |

完整版权与许可说明见 [`solver/vendor/LICENSES.md`](solver/vendor/LICENSES.md)。分发时请保留该文件及第三方源文件中已有的版权头。

---

<p align="center">
  <sub>何解 · Hegy — 把几何题变成可以动手玩的图形。</sub>
</p>
