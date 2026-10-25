#!/usr/bin/env node
/* mobile/tools/selfcheck-backend.js — 后端移植自检（Node，无需模拟器）
 *
 * 用「内存版 adapter + 假 post」把 localapi 跑起来，逐条验证：
 *   1. solve 全链路（POST → taskId → 订阅 running → 终态 done + 结果字段齐全）
 *   2. /api/tasks、/api/task/:id、/api/task/:id/cancel（取消后 status=error / error=CANCELLED）
 *   3. store：save → index 有 meta → record 读回 body → patchMeta → delete → index 消失
 *   4. index.json 被删掉后 index() 能扫目录重建
 *   5. cfg：POST 后 GET 能读回（含 apiKey）；/api/status 从 false 变 true
 *   6. 错误分类：post 抛 402 → err.title="API 额度不足"，日志里不含 apiKey
 *   7. sniffDataUrl 的 atob 版对 PNG/JPEG/WebP 魔数判断正确
 *   8. core 的纯 JS sha1 与 Node crypto 完全一致
 *
 * 跑法：cd E:\code\math\mobile && node tools/selfcheck-backend.js
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MOBILE = path.join(__dirname, "..");
const ROOT = path.join(MOBILE, "..");
const SOLVER = path.join(ROOT, "solver");

const createCore = require(path.join(SOLVER, "core.js"));
const createApi = require(path.join(MOBILE, "src", "localapi.js"));
const HXStoreFactory = require(path.join(MOBILE, "src", "bridge", "store.js"));
const createCfg = require(path.join(MOBILE, "src", "bridge", "cfg.js"));
const createHttp = require(path.join(MOBILE, "src", "bridge", "http.js"));

// ---------------- 测试夹具 ----------------
function readText(p) { try { return fs.readFileSync(p, "utf8"); } catch (e) { return ""; } }
const prompt = readText(path.join(SOLVER, "prompt.txt"));
const chatPrompt = readText(path.join(SOLVER, "chat-prompt.txt"));
const exName = fs.readdirSync(SOLVER).filter((n) => /^example_.*\.js$/.test(n) && !/^example_mock/i.test(n)).sort()[0];
const example = exName ? { name: exName, text: readText(path.join(SOLVER, exName)) } : null;
const core = createCore({ prompt: prompt, chatPrompt: chatPrompt, example: example });

// 一段「合法解题 JSON」：renderCode > 20 字、answer 非空，能过 validateResult
const GOOD = {
  answer: "$\\angle DFE = 10^\\circ$",
  analysis: "由 $AD$ 平分 $\\angle BAC$ 得 $\\angle BAD=\\angle DAC=40^\\circ$，再代入 $FE\\perp BC$ 即得。",
  questionText: "在 $\\triangle ABC$ 中，$AB=AC$，$\\angle B=40^\\circ$，$AD$ 平分 $\\angle BAC$ 交 $BC$ 于 $D$，求 $\\angle DFE$。",
  renderCode: "const board = GGBBoard.init('ggb-canvas', {boundingbox:[-1,5,7,-1], axis:false, showCopyright:false});\nboard.create('point',[0,0],{name:'A'});\nboard.create('segment',[board.objects.A,board.create('point',[3,0],{name:'B'})]);\n",
  steps: [
    { title: "作三角形", description: "先画 $\\triangle ABC$。", targets: ["A", "B"] },
    { title: "作角平分线", description: "$AD$ 平分 $\\angle BAC$。", targets: ["A", "D"] }
  ],
  subQuestions: []
};
function goodResponse() {
  return {
    status: 200,
    data: {
      choices: [{ message: { content: JSON.stringify(GOOD) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1200, completion_tokens: 300, total_tokens: 1500 }
    }
  };
}

// 内存文件系统：键是相对路径（Hegy/records/x.json）
function memAdapter() {
  const files = new Map();
  return {
    files: files,
    readText: async (p) => (files.has(p) ? files.get(p) : null),
    writeText: async (p, t) => { files.set(p, String(t)); },
    remove: async (p) => { files.delete(p); },
    list: async (dir) => {
      const pre = dir.endsWith("/") ? dir : dir + "/";
      return Array.from(files.keys())
        .filter((k) => k.indexOf(pre) === 0 && k.slice(pre.length).indexOf("/") < 0)
        .map((k) => k.slice(pre.length));
    },
    exists: async (p) => files.has(p),
    mkdir: async () => {},
    info: () => ({ dir: "Hegy", recordsDir: "Hegy/records", defaultDir: "Hegy", settingsFile: "Preferences:hegy.settings.v1" })
  };
}
function memPrefs() {
  const m = new Map();
  return {
    map: m,
    get: async (k) => (m.has(k) ? m.get(k) : null),
    set: async (k, v) => { m.set(k, String(v)); },
    remove: async (k) => { m.delete(k); }
  };
}
function makeApi(post) {
  const adapter = memAdapter();
  const prefs = memPrefs();
  const api = createApi({
    core: core,
    prefs: prefs,
    store: HXStoreFactory(adapter),
    cfg: createCfg(prefs),
    http: createHttp({ post: post })
  });
  return { api: api, adapter: adapter, prefs: prefs };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitTerminal(api, id, ms) {
  const t0 = Date.now();
  for (;;) {
    const r = await api.handle("GET", "/api/task/" + id);
    if (r.json && r.json.status && r.json.status !== "running") return r.json;
    if (Date.now() - t0 > (ms || 5000)) throw new Error("任务超时未结束: " + id);
    await sleep(10);
  }
}
const CFG = { baseUrl: "http://127.0.0.1:9/v1", apiKey: "sk-SECRET-abc", model: "mock" };

// ---------------- 断言 ----------------
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("PASS " + name + (extra ? "  [" + extra + "]" : "")); }
  else { fail++; console.log("FAIL " + name + (extra ? "  [" + extra + "]" : "")); }
}
function eq(name, actual, expected) {
  ok(name, actual === expected, "got " + JSON.stringify(actual) + " want " + JSON.stringify(expected));
}

(async function main() {
  // ---------- 1. solve 全链路 ----------
  console.log("== 1. solve 全链路 ==");
  const A = makeApi(async () => goodResponse());
  await A.api.init();
  const s1 = await A.api.handle("POST", "/api/solve", {
    question: "在三角形 ABC 中，AB=AC，∠B=40°，AD 平分∠BAC 交 BC 于 D，求∠DFE。",
    grade: "初二", dim: "2d", view: "true", stream: false, config: CFG
  });
  eq("POST /api/solve 返回 200", s1.status, 200);
  ok("返回 taskId + eventsUrl", !!(s1.json && s1.json.taskId && s1.json.eventsUrl), JSON.stringify(s1.json));
  const seen = [];
  const unsub = await A.api.subscribe(s1.json.taskId, (snap) => seen.push(snap));
  ok("subscribe 返回取消函数", typeof unsub === "function");
  ok("订阅首帧拿到 running 快照", seen.length > 0 && seen[0].status === "running", "status=" + (seen[0] && seen[0].status));
  ok("snapshot 字段齐全", !!(seen[0] && "id" in seen[0] && "kind" in seen[0] && "progress" in seen[0] && "stage" in seen[0] && "received" in seen[0]), JSON.stringify(seen[0]));
  const fin = await waitTerminal(A.api, s1.json.taskId);
  eq("终态 status", fin.status, "done");
  ok("result.renderCode 非空", !!(fin.result && fin.result.renderCode && fin.result.renderCode.length > 20), "len=" + (fin.result && fin.result.renderCode || "").length);
  eq("result.valid", fin.result && fin.result.valid, true);
  ok("result.attempts=1（一次过）", fin.result && fin.result.attempts === 1, String(fin.result && fin.result.attempts));
  ok("promptVer/promptHash/promptBytes 存在", !!(fin.result && fin.result.promptVer && fin.result.promptHash && fin.result.promptBytes), [fin.result && fin.result.promptVer, fin.result && fin.result.promptHash, fin.result && fin.result.promptBytes].join(" / "));
  eq("promptChannel", fin.result && fin.result.promptChannel, "2d");
  ok("usage 存在", !!(fin.result && fin.result.usage && fin.result.usage.total_tokens > 0));
  ok("订阅收到终态快照", seen.some((s) => s.status === "done"));
  unsub();

  // ---------- 2. 任务查询 / 取消 ----------
  console.log("\n== 2. 任务接口与取消 ==");
  const lt = await A.api.handle("GET", "/api/tasks");
  ok("/api/tasks 形状 {tasks:[]}", !!(lt.json && Array.isArray(lt.json.tasks) && lt.json.tasks.length >= 1), "n=" + (lt.json.tasks || []).length);
  const g1 = await A.api.handle("GET", "/api/task/" + s1.json.taskId);
  eq("/api/task/:id 终态", g1.json && g1.json.status, "done");
  const miss = await A.api.handle("GET", "/api/task/nope");
  eq("不存在的任务 404 NO_TASK", miss.status + "/" + (miss.json && miss.json.error), "404/NO_TASK");

  let release = null;
  const B = makeApi(() => new Promise((res) => { release = res; }));
  await B.api.init();
  const s2 = await B.api.handle("POST", "/api/solve", { question: "求∠A", config: CFG });
  await sleep(30);
  const c2 = await B.api.handle("POST", "/api/task/" + s2.json.taskId + "/cancel");
  eq("cancel 返回 ok", c2.json && c2.json.ok, true);
  const fin2 = await B.api.handle("GET", "/api/task/" + s2.json.taskId);
  eq("取消后 status=error", fin2.json && fin2.json.status, "error");
  eq("取消后 error=CANCELLED", fin2.json && fin2.json.error, "CANCELLED");
  // 放行挂起的请求：取消后回调里应直接丢弃，不再改状态
  if (release) release(goodResponse());
  await sleep(30);
  const fin2b = await B.api.handle("GET", "/api/task/" + s2.json.taskId);
  eq("取消后迟到的响应被丢弃", fin2b.json && fin2b.json.status, "error");

  // ---------- 2b. chat / refine ----------
  console.log("\n== 2b. chat 与 refine ==");
  const cEmpty = await A.api.handle("POST", "/api/chat", { messages: [], config: CFG });
  eq("chat 空消息 400 empty", cEmpty.status + "/" + (cEmpty.json && cEmpty.json.error), "400/empty");
  const s3 = await A.api.handle("POST", "/api/chat", {
    messages: [{ role: "user", content: "为什么要作辅助线？" }],
    question: "在三角形 ABC 中，AB=AC，求∠DFE。", answer: "10°", analysis: "略", config: CFG
  });
  eq("chat 返回 taskId", !!(s3.json && s3.json.taskId), true);
  const fin3 = await waitTerminal(A.api, s3.json.taskId);
  eq("chat 终态", fin3.status, "done");
  eq("chat kind", fin3.kind, "chat");
  ok("chat result.text 非空", !!(fin3.result && fin3.result.text && fin3.result.text.length));
  ok("chat result.usage 存在", !!(fin3.result && fin3.result.usage));

  const s4 = await A.api.handle("POST", "/api/refine", {
    instruction: "按给定答案重画", givenAnswer: "∠DFE=10°",
    previous: { answer: "10°", analysis: "略", renderCode: GOOD.renderCode },
    scope: "current", questionIndex: 1, config: CFG
  });
  const fin4 = await waitTerminal(A.api, s4.json.taskId);
  eq("refine 终态", fin4.status, "done");
  eq("refine.refined", fin4.result && fin4.result.refined, true);
  eq("refine 回填 givenAnswer", fin4.result && fin4.result.givenAnswer, "∠DFE=10°");
  eq("refine 回填 givenScope", fin4.result && fin4.result.givenScope, "current");
  eq("refine 回填 givenQuestionIndex", fin4.result && fin4.result.givenQuestionIndex, 1);
  eq("refine 通道沿用上一版 2D", fin4.result && fin4.result.promptChannel, "2d");
  const s5r = await A.api.handle("POST", "/api/refine", {
    instruction: "把解析写详细一点", target: "text",
    previous: { answer: "10°", analysis: "略", renderCode: GOOD.renderCode }, config: CFG
  });
  const fin5r = await waitTerminal(A.api, s5r.json.taskId);
  ok("target=text 答案变了会补 answerNote", !!(fin5r.result && /图形仍是旧的/.test(fin5r.result.answerNote || "")), fin5r.result && fin5r.result.answerNote);

  // ---------- 3. store CRUD ----------  console.log("\n== 3. store save/index/record/meta/delete ==");
  const rec = {
    id: "r-test-1", ts: Date.now(), question: "题目一", questionText: "题干一",
    answer: "答案一", analysis: "解析一", renderCode: GOOD.renderCode, grade: "初二", model: "mock",
    promptVer: "v2-2d", promptHash: "abc123def456", promptChannel: "2d",
    usage: { total_tokens: 100 }, images: [], steps: GOOD.steps
  };
  const sv = await A.api.handle("POST", "/api/store/save", { record: rec, thumb: "data:image/jpeg;base64,AAA" });
  eq("save 返回 ok", sv.json && sv.json.ok, true);
  const idx = await A.api.handle("GET", "/api/store/index");
  ok("index 形状 {dir, items}", !!(idx.json && idx.json.dir && Array.isArray(idx.json.items)));
  const m1 = (idx.json.items || []).find((m) => m.id === rec.id);
  ok("index 里有这条 meta", !!m1);
  eq("meta.question", m1 && m1.question, "题目一");
  eq("meta.thumb 落盘", m1 && m1.thumb, "data:image/jpeg;base64,AAA");
  eq("meta.promptHash", m1 && m1.promptHash, "abc123def456");
  const rd = await A.api.handle("GET", "/api/store/record/" + rec.id);
  eq("record 读回 answer", rd.json && rd.json.answer, "答案一");
  eq("record 读回 id", rd.json && rd.json.id, rec.id);
  ok("record 读回 renderCode", !!(rd.json && rd.json.renderCode === GOOD.renderCode));
  ok("record 读回 steps", !!(rd.json && Array.isArray(rd.json.steps) && rd.json.steps.length === 2));
  const pm = await A.api.handle("POST", "/api/store/meta", { id: rec.id, meta: { grade: "高一" } });
  eq("patchMeta ok", pm.json && pm.json.ok, true);
  eq("patchMeta 新 grade", pm.json && pm.json.meta && pm.json.meta.grade, "高一");
  eq("patchMeta 保留 thumb", pm.json && pm.json.meta && pm.json.meta.thumb, "data:image/jpeg;base64,AAA");
  const idx2 = await A.api.handle("GET", "/api/store/index");
  eq("index 同步 grade", (idx2.json.items || []).find((m) => m.id === rec.id).grade, "高一");
  const del = await A.api.handle("POST", "/api/store/delete", { id: rec.id });
  eq("delete ok", del.json && del.json.ok, true);
  const idx3 = await A.api.handle("GET", "/api/store/index");
  ok("index 里已消失", !(idx3.json.items || []).some((m) => m.id === rec.id));

  // ---------- 4. index.json 重建 ----------
  console.log("\n== 4. index.json 删除后重建 ==");
  await A.api.handle("POST", "/api/store/save", { record: Object.assign({}, rec, { id: "r-test-2" }), thumb: null });
  A.adapter.files.delete("Hegy/records/index.json");
  const idx4 = await A.api.handle("GET", "/api/store/index");
  ok("重建后仍有记录", !!(idx4.json && idx4.json.items.some((m) => m.id === "r-test-2")), "n=" + ((idx4.json && idx4.json.items) || []).length);
  ok("重建后 index.json 已写回", A.adapter.files.has("Hegy/records/index.json"));

  // ---------- 5. cfg / status ----------
  console.log("\n== 5. cfg 与 status ==");
  const st0 = await A.api.handle("GET", "/api/status");
  eq("初始 configured=false", st0.json && st0.json.configured, false);
  const sp = await A.api.handle("POST", "/api/cfg", { config: CFG });
  eq("POST /api/cfg ok", sp.json && sp.json.ok, true);
  const gc = await A.api.handle("GET", "/api/cfg");
  eq("GET /api/cfg 回填 apiKey", gc.json && gc.json.config && gc.json.config.apiKey, CFG.apiKey);
  eq("GET /api/cfg baseUrl", gc.json && gc.json.config && gc.json.config.baseUrl, CFG.baseUrl);
  eq("GET /api/cfg model", gc.json && gc.json.config && gc.json.config.model, CFG.model);
  const st1 = await A.api.handle("GET", "/api/status");
  eq("POST 后 configured=true", st1.json && st1.json.configured, true);
  // 请求里没带 config 时走 Preferences（与桌面 resolveCfg 同口径）
  const s5 = await A.api.handle("POST", "/api/solve", { question: "求∠B" });
  const fin5 = await waitTerminal(A.api, s5.json.taskId);
  eq("无 config 时用已存配置也能解题", fin5.status, "done");

  // ---------- 6. 错误分类 ----------
  console.log("\n== 6. 错误分类与日志 ==");
  const errPost = async () => {
    const e = new Error("HTTP_402");
    e.httpStatus = 402;
    e.body = '{"error":{"message":"Insufficient Balance","type":"insufficient_quota"}}';
    throw e;
  };
  const E = makeApi(errPost);
  await E.api.init();
  await E.api.handle("POST", "/api/cfg", { config: CFG });
  const s6 = await E.api.handle("POST", "/api/solve", { question: "求∠C", config: CFG });
  const fin6 = await waitTerminal(E.api, s6.json.taskId);
  eq("失败任务 status=error", fin6.status, "error");
  eq("err.title", fin6.err && fin6.err.title, "API 额度不足");
  eq("err.http", fin6.err && fin6.err.http, 402);
  eq("error code", fin6.error, "LLM_HTTP_402");
  const lg = await E.api.handle("GET", "/api/logs?limit=100");
  ok("日志有 1 条", !!(lg.json && lg.json.entries && lg.json.entries.length === 1), "n=" + (lg.json && lg.json.entries && lg.json.entries.length));
  eq("日志 title", lg.json.entries[0] && lg.json.entries[0].title, "API 额度不足");
  eq("日志只记 host", lg.json.entries[0] && lg.json.entries[0].host, "http://127.0.0.1:9");
  ok("日志不含 apiKey", JSON.stringify(lg.json).indexOf(CFG.apiKey) < 0);
  ok("日志已持久化到 Preferences", String(E.prefs.map.get("hegy.errors.v1") || "").indexOf(CFG.apiKey) < 0 && !!E.prefs.map.get("hegy.errors.v1"));
  const cl = await E.api.handle("POST", "/api/logs/clear");
  eq("logs/clear ok", cl.json && cl.json.ok, true);
  const lg2 = await E.api.handle("GET", "/api/logs");
  eq("清空后 total=0", lg2.json && lg2.json.total, 0);

  // ---------- 7. sniffDataUrl ----------
  console.log("\n== 7. sniffDataUrl（atob 版） ==");
  const b64 = (arr) => Buffer.from(arr).toString("base64");
  const PNG = "data:image/png;base64," + b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
  const JPG = "data:image/jpeg;base64," + b64([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0, 0, 0, 0]);
  const WEBP = "data:image/webp;base64," + b64([0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
  const GIF = "data:image/gif;base64," + b64([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
  eq("PNG 魔数", core.sniffDataUrl(PNG), "png");
  eq("JPEG 魔数", core.sniffDataUrl(JPG), "jpeg");
  eq("WebP 魔数", core.sniffDataUrl(WEBP), "webp");
  eq("GIF 不认", core.sniffDataUrl(GIF), "");
  eq("checkImages 接受 PNG", core.checkImages([PNG]).error, "");
  eq("checkImages 拒绝 GIF", core.checkImages([GIF]).error, "仅支持 JPG、PNG、WebP 格式的图片");
  eq("checkImages 空数组", core.checkImages([]).error, "");

  // ---------- 8. sha1 一致性 ----------
  console.log("\n== 8. core sha1 vs Node crypto ==");
  const samples = ["", "abc", "何解", "😀 emoji + 中文", prompt.slice(0, 5000), prompt + chatPrompt];
  let shaOk = true;
  samples.forEach((s, i) => {
    const a = core.sha1(s);
    const b = crypto.createHash("sha1").update(s, "utf8").digest("hex");
    if (a !== b) { shaOk = false; console.log("  DIFF #" + i + " len=" + s.length + " core=" + a + " node=" + b); }
  });
  ok("sha1 与 Node crypto 逐条一致（" + samples.length + " 组）", shaOk);
  const sp2 = core.assembleSystemPrompt("2d");
  eq("promptHash = sha1(text)[0:12]", sp2.hash, crypto.createHash("sha1").update(sp2.text, "utf8").digest("hex").slice(0, 12));
  eq("promptBytes = Buffer.byteLength", sp2.bytes, Buffer.byteLength(sp2.text, "utf8"));
  eq("utf8Len 与 Buffer 一致", core.utf8Len("何解😀abc"), Buffer.byteLength("何解😀abc", "utf8"));

  // ---------- 汇总 ----------
  console.log("\n----------------------------------------");
  if (fail) { console.log("FAILED: " + fail + " 项失败 / " + pass + " 项通过"); process.exit(1); }
  console.log("ALL PASS（" + pass + " 项）");
  process.exit(0);
})().catch((e) => {
  console.error("脚本异常：", e);
  process.exit(1);
});
