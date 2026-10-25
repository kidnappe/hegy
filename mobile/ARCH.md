# 何解 · 移动端 MVP（Android）

> 2026-10-22 起。方案依据 `../MOBILE-BACKEND-PLAN.md`（§8.1 PoC 结论）。
> 本目录是**新开发的移动端工程**，不改 `../solver/` 的桌面行为（例外：`core.js` 抽取见 §3；
> 框选页「重拍」通过 `window.HJSystemCamera` 调系统相机，桌面无该对象时行为不变）。

---

## 1. 一句话架构

```
Capacitor WebView
  └─ www/                    ← 由 tools/prepare.js 生成（solver/ + src/ 拼装）
       index.html            ← 桌面同一份，只在 head 里多两行（mobile.css / mobile 脚本）
       solver.js ui.js …     ← 除 cropRetake 的相机 hook 外原样
       core.js               ← 纯逻辑（提示词拼装 / payload / 校验 / 归一化 / 错误分类）
       localapi.js           ← 把 serve.js 的 /api/* 在进程内实现一遍
       bridge/{http,store,cfg}.js
       boot.js               ← patch window.fetch + window.EventSource → localapi
```

**关键决定：不改 solver.js，改它的"插座"。**
`boot.js` 在 `ui.js`/`solver.js` 之前接管 `window.fetch` 与 `window.EventSource`，
凡 `/api/*` 一律转给 `localapi.js`，其余（静态文件）走原生 fetch。
所以桌面 5181 行 solver.js、1789 行 ui.js、导出页全部原样复用。

---

## 2. `/api/*` 契约（localapi 必须逐条对齐 serve.js）

返回体形状必须与 `../solver/serve.js` 一致，否则前端静默降级（前端大量 `if (j && j.items)`）。

| 方法 | 路径 | 入参 | 返回 |
|---|---|---|---|
| POST | `/api/solve` | `{question, images[], grade, dim, view, config, stream}` | `{taskId, eventsUrl}` / `{error, message}` |
| POST | `/api/refine` | `{question, questionText, images[], answerImages[], instruction, target, scope, questionIndex, option, perQuestion[], givenAnswer, previous{}, grade, dim, view, config}` | 同上 |
| POST | `/api/chat` | `{messages[], question, questionText, answer, analysis, subQuestions[], renderCode, render3d, images[], grade, config}` | 同上 |
| POST | `/api/models` | `{config}` | `{ok:true, models[]}` / `{ok:false, error, hint, status?}` |
| GET | `/api/tasks` | — | `{tasks:[snapshot]}` |
| GET | `/api/task/:id` | — | `snapshot` / 404 `{error:"NO_TASK"}` |
| GET | `/api/task/:id/events` | — | SSE：`data: <snapshot>\n\n`（首帧立刻发一次；running 时持续推；终态后 end） |
| POST | `/api/task/:id/cancel` | — | `{ok:true, id, status}` |
| GET | `/api/store/index` | — | `{dir, items:[meta]}` |
| GET | `/api/store/record/:id` | — | 完整记录（body + id/ts）/ 404 `{error:"NOT_FOUND"}` |
| POST | `/api/store/save` | `{record, thumb}` | `{ok:true, id, dir}` |
| POST | `/api/store/meta` | `{id, meta}` | `{ok:true, meta}` |
| POST | `/api/store/delete` | `{id}` | `{ok:true}` |
| POST | `/api/store/purge` | — | `{ok:true, removed:n}` |
| POST | `/api/store/migrate` | `{records:[{record,thumb}]}` | `{ok:true, imported:n, dir}` |
| GET | `/api/store/info` | — | `{dir, recordsDir, defaultDir, count, settingsFile, migrated}` |
| POST | `/api/store/dir` `/open` `/pick` | — | 移动端**不支持** → `{error:"NOT_SUPPORTED", message:"手机上不支持换目录"}` |
| GET | `/api/cfg` | — | `{config: {baseUrl, apiKey, model, temperature, priceIn, priceOut, currency} \| null}` |
| POST | `/api/cfg` | `{config}` | `{ok:true}` |
| GET | `/api/status` | — | `{configured: bool}`（移动端 = 是否已存配置） |
| GET | `/api/logs?limit=n` | — | `{entries[], file, total}` |
| POST | `/api/logs/clear` | — | `{ok:true}` |

`snapshot` 形状（`solver.js` 的 `settle()` 依赖，字段不能少）：

```js
{ id, kind, snippet, status:"running|done|error", progress:0-100, stage, received,
  reasoning?, partial?（仅 chat 且非 final）, result?, error?, message?, err?:{code,title,hint,http} }
```

`meta` 形状见 `../solver/serve.js` 的 `metaOf()`（id/ts/question/qlen/questionText/grade/model/
refined/verCount/promptVer/promptHash/promptChannel/elapsedMs/usage/cost/imgCount/chatCount/has3d/hasCode/thumb）。

---

## 3. core.js（与桌面共用，防双端分叉）

从 `../solver/serve.js` 抽出**纯逻辑**（不碰 fs / http / os / crypto）：

- `assembleSystemPrompt(channel)`、`promptChannel(req, isRefine)`、`promptExample()`
- `buildSolvePayload` / `buildRefinePayload` / `buildChatPayload` 及全部 `*Note()` 注入函数
- `parseModelJson` / `validateResult` / `stepsWarn` / `figKind` / `autoRouteCheck` / `normalizeResult` / `estimateUsage`
- `checkText` / `checkImages` / `sniffDataUrl`（Buffer → atob/Uint8Array）
- `classifyError` / `errRaw` / `safeHost`（错误一句话口径，桌面与手机同一张表）
- 常量：`GRADES` / `Q_MAX` / `CHAT_*` / `BAD_INPUT_RE` …

**形态**：UMD 工厂，两个环境共用一份源码：

```js
// Node（serve.js）
const HXCore = require("./core.js")({ prompt, chatPrompt, example, sha1 });
// 浏览器（localapi.js）
const HXCore = window.HXCore.create({ prompt, chatPrompt, example });
```

`deps` 只传**资源文本**，不传文件系统：`{prompt, chatPrompt, example}`（`example` 可为 null）。
`sha1` 可选，缺省用内置纯 JS 实现（浏览器没有 crypto.subtle 的同步版）。

> 桌面侧：`serve.js` 改成 `require("./core.js")` 并删掉本地副本，行为必须逐字不变。
> 校验：`node tools/check_prompt.js` + `check_prompt_content.js` + 起 8099/8098 跑一次 mock 解题。

---

## 4. 存储（PoC-4 结论：index.json 必须）

- 目录：`Filesystem.Directory.Data` 下的 `Hegy/records/`（App 私有目录，卸载即清）。
- 一条记录仍是一个 `<id>.json`，**两行 JSONL**（首行 meta + 次行 body）——格式与桌面完全一致，方便互导。
- 但**列表绝不扫目录读首行**（PoC-4：100 条整读 4.99s）。改读写 `records/index.json`：
  ```json
  { "ver": 1, "updatedAt": 0, "items": [ /* meta… */ ] }
  ```
- `index.json` 是**派生数据**：缺失/损坏时用目录扫描重建（冷启动一次），重建后写回。
- 缩略图压到 ≤ 100KB（`thumb` 字段，160px JPEG q0.6，由 solver.js 生成，后端只管存）。

## 5. 配置与密钥

- 字段结构与桌面 `settings.json` 的 `model` 段完全一致（前端只认这套字段）。
- 存 `Preferences`（`hegy.settings.v1`）；`apiKey` 额外写一份 `Preferences` 的 `hegy.apikey.v1`，
  前端读配置时后端自动回填（`config.apiKey` 必须回填，否则设置面板显示空、测试连接失败）。
- MVP 不做 Keystore 加密（PoC 未验证），但**代码里留 `secure` 钩子**，后续换 `capacitor-secure-storage-plugin` 只改一个文件。

## 6. LLM 通道

- `CapacitorHttp` 显式调用（`Capacitor.Plugins.CapacitorHttp.post`），**不开启全局 patch**
  （`capacitor.config.json` 里 `CapacitorHttp.enabled:false`），否则 `/api/*` 也会被它接管。
- MVP **非流式**：`stream:false`，一次拿到整段 JSON。
  PoC-1 坑：推理模型的 `max_tokens` 要覆盖 `reasoning_content`，默认给 8192；
  若 `content` 为空且 `finish_reason=length`，把 `max_tokens` 提到 16384 重试一次。
- `readTimeout` 放宽到 **600000ms**（PoC-3：后台冻结期间 OkHttp 按墙钟计时，120s 必超）。
- 进度：非流式拿不到增量 → `stage` 用「模型思考中…（已 Ns）」按 1s 心跳推进，
  进度条用 `startProgress` 同款缓动封顶 86%。
- 切后台：任务状态落 `Preferences`（`hegy.task.v1`），回前台 `localapi` 检查未完成任务 →
  能读到结果就补发终态，读不到就标 `任务已失效`（沿用前端现成文案）。

---

## 7. 分工（并行两条线，文件不重叠）

| 线 | 只许改 | 不许碰 |
|---|---|---|
| 后端 | `mobile/src/core.js`、`mobile/src/localapi.js`、`mobile/src/bridge/*`、`mobile/tools/selfcheck-backend.js`、`../solver/core.js`、`../solver/serve.js` | `mobile/src/overlay/*`、`mobile/www/*`、`../solver/solver.js`、`../solver/ui.*`、`../solver/index.html` |
| UI | `mobile/src/overlay/mobile.css`、`mobile/src/overlay/mobile-ui.js`、`mobile/tools/ui-harness.js` | `mobile/src/*.js`、`mobile/src/bridge/*`、`mobile/www/*`、`../solver/*` |
| 集成 | `mobile/tools/prepare.js`、`mobile/src/overlay/boot.js`、`package.json`、`capacitor.config.json`、android 构建 | — |

`www/` 是生成物（`node tools/prepare.js`），**任何人不许手改**，也不进 git。

---

## 8. 跑起来

```bash
cd mobile
node tools/prepare.js          # solver + src → www
npx cap sync android
cd android && ./gradlew.bat assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.hejie.solver/.MainActivity
```

模拟器：`emulator-5554`（AVD `isd_api36`，Android 16 / x86_64）。
JDK 21 与 Android SDK 按本机路径设置 `JAVA_HOME` / `ANDROID_HOME`（`gradlew` 不读 PATH 里的 java）。
