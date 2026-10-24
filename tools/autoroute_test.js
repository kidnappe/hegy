#!/usr/bin/env node
/* 自动通道“窄后校验”自检
   用法：node tools\autoroute_test.js

   覆盖：
   A. 判定函数：三视图/展开图 + 3D 才触发；显式 2D/3D、立体图、还原、微调、普通空间题都不触发；
      纯图片题（question 为空）用客户端/模型识别的 questionText 判定。
   B. 集成：假 LLM(8126) + 独立 serve(8127)，验证：
      - 三视图首次返回 3D → 自动重试一次 → 第二次 2D，结果带 route* 诊断；
      - 重试后仍是 3D → valid=false，issues 里保留原因；
      - 纯图片题只带 images、question 为空，仍能触发并改回 2D；普通空间图片题不误触发；
      - 显式 3D/显式 2D/立体图/普通空间题只调用一次。
   完全隔离：USERPROFILE 指向临时目录，结束自动清理进程和临时目录。
*/
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const http = require("http");
const { spawn, execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SERVE_PATH = path.join(ROOT, "solver", "serve.js");
const SERVE = fs.readFileSync(SERVE_PATH, "utf8");
const HOME = path.join(os.tmpdir(), "hegy-autoroute-" + process.pid);
const MPORT = 8126, SPORT = 8127;
const API = "http://127.0.0.1:" + SPORT;
const CFG = { baseUrl: "http://127.0.0.1:" + MPORT + "/v1", apiKey: "fake", model: "fake", temperature: 0, stream: false };
// checkImages 只嗅探前 40 个 base64 字符；假 LLM 用后缀标记区分用例（仅本测试使用，不会发给真实 API）。
const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;
const ok = (n, c, x) => { if (c) console.log("  ok   " + n + (x ? "  [" + x + "]" : "")); else { console.log("  FAIL " + n + (x ? "  [" + x + "]" : "")); fails++; } };

let fake = null, serveProc = null;
function killTree(p) {
  if (!p || !p.pid) return;
  try {
    if (process.platform === "win32") execSync("taskkill /pid " + p.pid + "/t /f", { stdio: "ignore" });
    else p.kill("SIGTERM");
  } catch (e) {}
}
function cleanup() {
  killTree(serveProc);
  try { if (fake) fake.close(); } catch (e) {}
  try { fs.rmSync(HOME, { recursive: true, force: true }); } catch (e) {}
}
process.on("exit", cleanup);

// ---------- A. 直接测 serve.js 里的判定函数 ----------
function extractFn(name) {
  const start = SERVE.indexOf("function " + name + "(");
  if (start < 0) throw new Error("找不到函数: " + name);
  let i = SERVE.indexOf("{", start), depth = 0, str = "", esc = false;
  for (; i < SERVE.length; i++) {
    const ch = SERVE[i];
    if (str) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === str) str = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { str = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return SERVE.slice(start, i + 1); }
  }
  throw new Error("函数体不完整: " + name);
}
const fnCode = extractFn("figKind") + "\n" + extractFn("autoRouteCheck") + "\nmodule.exports={figKind,autoRouteCheck};";
const mod = { exports: {} };
vm.runInNewContext(fnCode, { module: mod, exports: mod.exports }, { filename: SERVE_PATH });
const autoRouteCheck = mod.exports.autoRouteCheck;

const obj3d = { answer: "x", render3d: { points: [{ id: "A", coords: [0, 0, 0] }] } };
const obj2d = { answer: "x", renderCode: "const board = GGBBoard.init('ggb-canvas', { axis: false, showCopyright: false });" };
const check = (q, obj, extra, isRefine) => autoRouteCheck(Object.assign({ question: q }, extra || {}), obj, !!isRefine);

console.log("=== A. 判定函数 ===");
let c = check("一个几何体的三视图如图，求它的体积", obj3d);
ok("三视图 + 3D → 触发", c.expected === "2d" && /renderCode/.test(c.issue), JSON.stringify(c));
c = check("一个几何体的三视图如图，求它的体积", obj2d);
ok("三视图 + 2D → 不触发", c.expected === "2d" && c.issue === "", JSON.stringify(c));
c = check("一个几何体的三视图如图，求它的体积", obj3d, { dim: "3d" });
ok("显式 3D → 不触发", c.expected === "" && c.issue === "", JSON.stringify(c));
c = check("一个几何体的三视图如图，写出它的立体图", obj3d);
ok("明确要立体图 → 不触发", c.expected === "" && c.issue === "", JSON.stringify(c));
c = check("一个几何体的三视图如图，求这个立体图形的体积", obj3d);
ok("“立体图形”不算明确要立体图", c.expected === "2d" && !!c.issue, JSON.stringify(c));
c = check("如图是正方体的展开图，求二面角", obj3d);
ok("展开图 + 3D → 触发", c.expected === "2d" && !!c.issue, JSON.stringify(c));
c = check("正方体展开图的动态展开过程", obj3d);
ok("动态展开 → 不触发", c.expected === "" && c.issue === "", JSON.stringify(c));
c = check("根据三视图还原该几何体", obj3d);
ok("三视图还原 → 不触发", c.expected === "" && c.issue === "", JSON.stringify(c));
c = check("一个几何体的三视图如图，画出该几何体", obj3d);
ok("画出该几何体 → 不触发", c.expected === "" && c.issue === "", JSON.stringify(c));
c = check("一个几何体的三视图如图，画出该几何体的三视图", obj3d);
ok("画出该几何体的三视图 → 仍触发", c.expected === "2d" && !!c.issue, JSON.stringify(c));
c = check("在正方体中求异面直线所成角", obj3d);
ok("普通空间题 → 不触发", c.expected === "" && c.issue === "", JSON.stringify(c));
c = check("一个几何体的三视图如图，求它的体积", obj3d, {}, true);
ok("微调 → 不触发", c.expected === "" && c.issue === "", JSON.stringify(c));
c = check("", Object.assign({ questionText: "一个几何体的三视图如图，求它的体积" }, obj3d));
ok("纯图片：识图题干是三视图 + 3D → 触发", c.expected === "2d" && !!c.issue, JSON.stringify(c));
c = check("", Object.assign({ questionText: "一个几何体的三视图如图，求它的体积" }, obj2d));
ok("纯图片：识图题干是三视图 + 2D → expected=2d 不触发", c.expected === "2d" && c.issue === "", JSON.stringify(c));
c = check("", Object.assign({ questionText: "在正方体中求异面直线所成角" }, obj3d));
ok("纯图片：普通空间题 → 不触发", c.expected === "" && c.issue === "", JSON.stringify(c));
c = check("", obj3d, { questionText: "一个几何体的三视图如图，求它的体积" });
ok("纯图片：客户端已给 questionText → 触发", c.expected === "2d" && !!c.issue, JSON.stringify(c));
c = autoRouteCheck({ question: "" }, obj3d, false, "一个几何体的三视图如图，求它的体积");
ok("纯图片：重试沿用首次识图题干 → 触发", c.expected === "2d" && !!c.issue, JSON.stringify(c));

// ---------- B. 集成：假 LLM + 独立 serve ----------
const calls = [];
const counters = Object.create(null);
function fakeResult(text) {
  const has = (s) => text.indexOf(s) >= 0;
  // 纯图片题：question 为空，只能靠返回的 questionText 让后校验识别题型。
  if (has("PUREIMG3V3D")) {
    return { questionText: "一个几何体的三视图如图，求它的体积", answer: "纯图片 3D", analysis: "识图后始终给 3D", render3d: { points: [{ id: "A", coords: [0, 0, 0] }, { id: "B", coords: [1, 0, 0] }] } };
  }
  if (has("PUREIMG3V")) {
    const n = counters["PUREIMG3V"] || 0;
    counters["PUREIMG3V"] = n + 1;
    const base = { questionText: "一个几何体的三视图如图，求它的体积" };
    return n === 0
      ? Object.assign(base, { answer: "纯图片 3D", analysis: "识图后先给了 3D", render3d: { points: [{ id: "A", coords: [0, 0, 0] }, { id: "B", coords: [1, 0, 0] }] } })
      : Object.assign(base, { answer: "纯图片 2D", analysis: "重试后改回多视图", renderCode: "const board = GGBBoard.init('ggb-canvas', { axis: false, showCopyright: false });" });
  }
  if (has("PUREIMGSPACE")) {
    return { questionText: "在棱长为 2 的正方体中，求异面直线所成角", answer: "纯图片空间题", analysis: "合法 3D", render3d: { points: [{ id: "A", coords: [0, 0, 0] }, { id: "B", coords: [1, 0, 0] }] } };
  }
  // 第一次给“结构不合格的 3D”（points 为空），第二次给合格但通道仍不对的 3D。
  if (has("首次坏立体")) {
    const n = counters["首次坏立体"] || 0;
    counters["首次坏立体"] = n + 1;
    return n === 0
      ? { answer: "坏 3D", analysis: "points 为空", render3d: { points: [] } }
      : { answer: "好 3D", analysis: "结构合格但仍是 3D", render3d: { points: [{ id: "A", coords: [0, 0, 0] }] } };
  }
  let use3d = false;
  if (has("始终立体")) use3d = true;
  else if (has("立体图")) use3d = true;
  else if (has("显式2D")) use3d = true;
  else if (has("重试成功")) {
    const n = counters["重试成功"] || 0;
    counters["重试成功"] = n + 1;
    use3d = n === 0;
  } else if (/正方体|异面直线|棱锥|二面角/.test(text)) use3d = true;
  return use3d
    ? { answer: "3D 示例答案", analysis: "3D 示例解析", render3d: { points: [{ id: "A", coords: [0, 0, 0] }, { id: "B", coords: [1, 0, 0] }] } }
    : { answer: "2D 示例答案", analysis: "2D 示例解析", renderCode: "const board = GGBBoard.init('ggb-canvas', { axis: false, showCopyright: false });" };
}
function startFake() {
  return new Promise((resolve, reject) => {
    fake = http.createServer((req, res) => {
      let body = "";
      req.on("data", (d) => { body += d; });
      req.on("end", () => {
        let j = {};
        try { j = JSON.parse(body); } catch (e) {}
        // 只看最后一条 user 消息，避免系统提示里的“立体图”等词干扰假模型。
        const user = (j.messages || []).filter((m) => m && m.role === "user").pop();
        const text = user ? (typeof user.content === "string" ? user.content : JSON.stringify(user.content)) : "";
        calls.push({ text });
        const obj = fakeResult(text);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(obj) } }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
      });
    });
    fake.on("error", reject);
    fake.listen(MPORT, "127.0.0.1", resolve);
  });
}
async function waitHttp(url, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.ok) return true; } catch (e) {}
    await sleep(150);
  }
  return false;
}
async function solveAndWait(question, extra) {
  const before = calls.length;
  const r = await fetch(API + "/api/solve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(Object.assign({ question, config: CFG, stream: false }, extra || {}))
  });
  const j = await r.json();
  if (!r.ok || !j.taskId) throw new Error("提交失败：" + JSON.stringify(j));
  let t = null;
  for (let i = 0; i < 150; i++) {
    await sleep(100);
    const tr = await fetch(API + "/api/task/" + j.taskId);
    t = await tr.json();
    if (t.status !== "running") break;
  }
  if (!t || t.status === "running") throw new Error("任务超时");
  if (t.status === "error") throw new Error("任务失败：" + (t.error || "") + " " + (t.message || ""));
  return { result: t.result, calls: calls.slice(before) };
}

(async () => {
  fs.mkdirSync(HOME, { recursive: true });
  await startFake();
  serveProc = spawn(process.execPath, [SERVE_PATH, String(SPORT)], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { USERPROFILE: HOME, HOME }),
    stdio: "ignore"
  });
  if (!await waitHttp(API + "/api/status", 10000)) throw new Error("serve 未启动");

  console.log("\n=== B1. 三视图首次 3D → 自动重试为 2D ===");
  let r = await solveAndWait("（自动路由测试·重试成功）一个几何体的三视图如图，求它的体积。");
  ok("调用了 2 次模型", r.calls.length === 2, String(r.calls.length));
  ok("第二次请求带「上次输出不合格」", /上次输出不合格/.test(r.calls[1] && r.calls[1].text || ""));
  ok("最终给 renderCode", !!r.result.renderCode && !r.result.render3d);
  ok("attempts=2", r.result.attempts === 2, String(r.result.attempts));
  ok("routeExpected=2d", r.result.routeExpected === "2d", r.result.routeExpected);
  ok("routeActual=2d", r.result.routeActual === "2d", r.result.routeActual);
  ok("routeRetried=true", r.result.routeRetried === true);
  ok("routeIssue 为空（已改正）", r.result.routeIssue === "", r.result.routeIssue);
  ok("valid=true", r.result.valid === true);

  console.log("\n=== B2. 重试后仍是 3D → 保留结果但标不完整 ===");
  r = await solveAndWait("（自动路由测试·始终立体）一个几何体的三视图如图，求它的体积。");
  ok("调用了 2 次模型", r.calls.length === 2, String(r.calls.length));
  ok("保留 render3d", !!r.result.render3d && !r.result.renderCode);
  ok("routeExpected=2d", r.result.routeExpected === "2d", r.result.routeExpected);
  ok("routeActual=3d", r.result.routeActual === "3d", r.result.routeActual);
  ok("routeRetried=true", r.result.routeRetried === true);
  ok("routeIssue 非空", /renderCode/.test(r.result.routeIssue || ""), r.result.routeIssue);
  ok("valid=false", r.result.valid === false);
  ok("issues 里保留原因", (r.result.issues || []).some((x) => /renderCode/.test(x)));

  console.log("\n=== B2b. 首次结构不合格、第二次合格但仍是 3D → 接受第二次 ===");
  r = await solveAndWait("（自动路由测试·首次坏立体）一个几何体的三视图如图，求它的体积。");
  ok("调用了 2 次模型", r.calls.length === 2, String(r.calls.length));
  ok("保留第二次的 render3d", !!(r.result.render3d && r.result.render3d.points && r.result.render3d.points.length));
  ok("routeActual=3d", r.result.routeActual === "3d", r.result.routeActual);
  ok("routeIssue 仍非空", /renderCode/.test(r.result.routeIssue || ""));
  ok("valid=false", r.result.valid === false);
  ok("routeRetried=false（本次重试由缺图触发）", r.result.routeRetried === false);

  console.log("\n=== B3. 明确要立体图 → 不重试 ===");
  r = await solveAndWait("（自动路由测试·立体图）一个几何体的三视图如图，请画出它的立体图。");
  ok("只调用 1 次", r.calls.length === 1, String(r.calls.length));
  ok("routeExpected 为空", r.result.routeExpected === "", r.result.routeExpected);
  ok("routeRetried=false", r.result.routeRetried === false);
  ok("保留 render3d", !!r.result.render3d && r.result.valid === true);

  console.log("\n=== B4. 显式 2D 优先 → 不自动改通道 ===");
  r = await solveAndWait("（自动路由测试·显式2D）一个几何体的三视图如图，求它的体积。", { dim: "2d" });
  ok("只调用 1 次", r.calls.length === 1, String(r.calls.length));
  ok("routeExpected 为空", r.result.routeExpected === "", r.result.routeExpected);
  ok("routeRetried=false", r.result.routeRetried === false);
  ok("routeActual=3d（模型自己的选择）", r.result.routeActual === "3d", r.result.routeActual);

  console.log("\n=== B5. 普通空间题 → 不重试 ===");
  r = await solveAndWait("在棱长为 2 的正方体 ABCD-A1B1C1D1 中，求异面直线 A1B 与 B1C 所成角。");
  ok("只调用 1 次", r.calls.length === 1, String(r.calls.length));
  ok("routeExpected 为空", r.result.routeExpected === "", r.result.routeExpected);
  ok("routeRetried=false", r.result.routeRetried === false);
  ok("保留 render3d", !!r.result.render3d && r.result.valid === true);

  console.log("\n=== B6. 纯图片三视图：识图题干 → 首次 3D → 重试 2D ===");
  r = await solveAndWait("", { images: [TINY_PNG + "PUREIMG3V"] });
  ok("调用了 2 次模型", r.calls.length === 2, String(r.calls.length));
  ok("第二次请求仍带图片", /PUREIMG3V/.test(r.calls[1] && r.calls[1].text || ""));
  ok("最终给 renderCode", !!r.result.renderCode && !r.result.render3d);
  ok("routeExpected=2d（来自 questionText）", r.result.routeExpected === "2d", r.result.routeExpected);
  ok("routeActual=2d", r.result.routeActual === "2d", r.result.routeActual);
  ok("routeRetried=true", r.result.routeRetried === true);
  ok("valid=true", r.result.valid === true);

  console.log("\n=== B7. 纯图片三视图：重试后仍 3D → 标不完整 ===");
  r = await solveAndWait("", { images: [TINY_PNG + "PUREIMG3V3D"] });
  ok("调用了 2 次模型", r.calls.length === 2, String(r.calls.length));
  ok("routeExpected=2d", r.result.routeExpected === "2d", r.result.routeExpected);
  ok("routeActual=3d", r.result.routeActual === "3d", r.result.routeActual);
  ok("routeIssue 非空", /renderCode/.test(r.result.routeIssue || ""), r.result.routeIssue);
  ok("valid=false", r.result.valid === false);

  console.log("\n=== B8. 纯图片普通空间题：question 为空 → 不误触发 ===");
  r = await solveAndWait("", { images: [TINY_PNG + "PUREIMGSPACE"] });
  ok("只调用 1 次", r.calls.length === 1, String(r.calls.length));
  ok("routeExpected 为空", r.result.routeExpected === "", r.result.routeExpected);
  ok("routeRetried=false", r.result.routeRetried === false);
  ok("保留 render3d", !!r.result.render3d && r.result.valid === true);

  console.log("\n" + (fails ? "RESULT: " + fails + " failed" : "RESULT: all passed"));
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error("ERROR:", e && e.stack || e);
  process.exit(1);
});
