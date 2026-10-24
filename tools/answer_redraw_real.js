// §58 答案校准重画：真模型验收（会消耗 token，不属于日常回归）
// 用法: node tools\answer_redraw_real.js
//
// 隔离策略：复制真实 ~/.hegy/settings.json 到临时 home（保留模型配置），
// historyDir 指向临时目录；不写真实 Documents\Hegy，也不改真实 settings.json。
// 端口：serve 8121 / CDP 9443（若被占用先改常量）。
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const EPORT = 9443, SPORT = 8121;
const APP = "http://127.0.0.1:" + SPORT + "/solver/index.html";
const API = "http://127.0.0.1:" + SPORT;
const HOME = path.join(os.tmpdir(), "hegy-ans-real-" + process.pid);
const SHOTS = path.join(__dirname, "shots_new");
const Q = process.env.Q || "在△ABC中，AB=AC，BD 平分∠ABC 交 AC 于 D。若∠A=40°，求∠BDC 的度数。请画出图形并标注角度。";
const GOOD = process.env.GOOD || "∠BDC = 75°（用户给定）";
const BAD = process.env.BAD || "∠BDC = 99°（用户给定）";
const NUM = process.env.NUM || "75";
const NEG = process.env.NEG || "99";
const TAG = process.env.TAG || "real_answer";
const DIM = process.env.DIM || "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (n, c, x) => { if (c) console.log("  ok   " + n + (x ? "  [" + x + "]" : "")); else { console.log("  FAIL " + n + (x ? "  [" + x + "]" : "")); fails++; } };
const info = (n, x) => console.log("  info " + n + (x != null ? "  [" + x + "]" : ""));
const clip = (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").slice(0, n || 160);

let edgeProc = null, serveProc = null;
function killTree(p) { if (p && p.pid) { try { execSync("taskkill /pid " + p.pid + "/t /f", { stdio: "ignore" }); } catch (e) {} } }
function cleanup() {
  killTree(edgeProc); killTree(serveProc);
  try { fs.rmSync(HOME, { recursive: true, force: true }); } catch (e) {}
}
process.on("exit", cleanup);

async function waitHttp(url, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.ok) return true; } catch (e) {}
    await sleep(300);
  }
  return false;
}

function makeHome() {
  fs.mkdirSync(path.join(HOME, ".hegy"), { recursive: true });
  fs.mkdirSync(path.join(HOME, "data"), { recursive: true });
  const real = path.join(os.homedir(), ".hegy", "settings.json");
  if (!fs.existsSync(real)) throw new Error("找不到真实 settings.json");
  const s = JSON.parse(fs.readFileSync(real, "utf8"));
  if (!s.model || !s.model.baseUrl || !s.model.apiKey) throw new Error("真实配置缺少模型信息");
  info("真实模型", s.model.model + " @ " + s.model.baseUrl);
  s.historyDir = path.join(HOME, "data");
  fs.writeFileSync(path.join(HOME, ".hegy", "settings.json"), JSON.stringify(s, null, 2), "utf8");
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  makeHome();
  const env = Object.assign({}, process.env, { USERPROFILE: HOME, HOME: HOME });
  serveProc = spawn(process.execPath, [path.join(ROOT, "solver", "serve.js"), String(SPORT)], { env, stdio: "ignore" });
  if (!(await waitHttp(API + "/api/status", 15000))) throw new Error("服务未启动");
  const cfg = await (await fetch(API + "/api/cfg")).json();
  ok("服务端已加载真实配置", !!(cfg && cfg.config && cfg.config.baseUrl && cfg.config.apiKey && cfg.config.model), cfg && cfg.config && cfg.config.model);

  edgeProc = spawn(EDGE, ["--headless=new", "--remote-debugging-port=" + EPORT,
    "--user-data-dir=" + path.join(os.tmpdir(), "edge-ans-real-" + process.pid),
    "--no-first-run", "--no-default-browser-check", "--disable-gpu", "about:blank"], { stdio: "ignore" });
  let ver = null;
  for (let i = 0; i < 80; i++) { try { ver = await (await fetch("http://127.0.0.1:" + EPORT + "/json/version")).json(); break; } catch (e) { await sleep(250); } }
  if (!ver) throw new Error("no devtools");
  const tab = await (await fetch("http://127.0.0.1:" + EPORT + "/json/new?about:blank", { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const pageErrs = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails || {};
      pageErrs.push((d.exception && d.exception.description) || d.text || "exception");
    }
  });
  await new Promise((r) => ws.addEventListener("open", r));
  const send = (m, p) => new Promise((res) => {
    const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p || {} }));
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); res({}); } }, 30000);
  });
  const ev = async (expr, ms) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, timeout: ms || 30000 });
    const rr = r.result || {};
    if (rr.exceptionDetails) throw new Error((rr.exceptionDetails.exception || {}).description || "eval error");
    return (rr.result && "value" in rr.result) ? rr.result.value : null;
  };
  const until = async (expr, ms, step) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await ev(expr).catch(() => false); if (v) return v; await sleep(step || 300); } return false; };
  const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); if (r.result && r.result.data) fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.result.data, "base64")); };
  const ready = "!!(window.mathHTML && window.SolverDebug && document.getElementById('ansEditBtn') && document.getElementById('ansNote'))";
  const idle = "SolverDebug.tasks().filter(function(t){return t.status==='running';}).length===0";

  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 950, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: APP });
  await until(ready, 30000, 200);
  ok("前端拉起", true);
  info("界面模型", await ev("(document.getElementById('cfg')&&document.getElementById('cfg').textContent)||''"));

  console.log("\n=== A. 真模型解题 ===");
  const q = Q;
  const t0 = Date.now();
  if (DIM) await ev("var d=document.getElementById('dim');d.value=" + JSON.stringify(DIM) + ";d.dispatchEvent(new Event('change'));1");
  await ev("document.getElementById('q').value=" + JSON.stringify(q) + ";document.getElementById('go').click();1");
  ok("解题完成", await until("(function(){var L=SolverDebug.last();return !!(L&&L.result&&L.result.answer)&&(" + idle + ");})()", 300000, 500));
  const solveMs = Date.now() - t0;
  info("耗时", (solveMs / 1000).toFixed(1) + "s");
  const recId = await ev("SolverDebug.recId()");
  ok("有记录 id", !!recId, recId || "");
  const r0 = await ev("SolverDebug.last().result");
  info("模型首答", clip(r0 && r0.answer, 200));
  info("图形类型", r0 && (r0.render3d ? "3D" : "2D") + " / renderCode " + String(r0.renderCode || "").length + "B");
  ok("答案包含 " + NUM + "°", r0 && String(r0.answer).indexOf(NUM) >= 0, clip(r0 && r0.answer, 120));
  await shot(TAG + "_solved.png");

  console.log("\n=== B. 给定正确答案（" + NUM + "°）重画 ===");
  await ev("document.getElementById('ansEditBtn').click();1");
  ok("编辑器打开并预填", await ev("SolverDebug.ansEdit().open===true && document.getElementById('ansEditIn').value===SolverDebug.last().result.answer"));
  const given1 = GOOD;
  const t1 = Date.now();
  await ev("document.getElementById('ansEditIn').value=" + JSON.stringify(given1) + ";document.getElementById('ansEditIn').dispatchEvent(new Event('input'));document.getElementById('ansRedraw').click();1");
  ok("重画结果待确认", await until("!!SolverDebug.review()", 300000, 500));
  info("耗时", ((Date.now() - t1) / 1000).toFixed(1) + "s");
  const r1 = await ev("SolverDebug.last().result");
  ok("结果带 givenAnswer", r1 && r1.givenAnswer === given1, clip(r1 && r1.givenAnswer, 80));
  ok("未标记答案纠正", r1 && r1.answerAdjusted === false, r1 && String(r1.answerAdjusted));
  info("answerNote", clip(r1 && r1.answerNote, 200));
  info("纠正后答案", clip(r1 && r1.answer, 200));
  info("纠正后图形", (r1 && r1.render3d ? "3D" : "2D") + " / renderCode " + String(r1 && r1.renderCode || "").length + "B");
  ok("答案包含给定 " + NUM + "°", r1 && String(r1.answer).indexOf(NUM) >= 0);
  ok("提示为已按给定答案", await ev("(function(){var n=document.getElementById('ansNote');return getComputedStyle(n).display!=='none'&&n.className.indexOf('ok')>=0&&n.textContent.indexOf('已按你给的')>=0;})()"),
    clip(await ev("document.getElementById('ansNote').textContent"), 160));
  ok("图形已重新生成", !!(r1 && (r1.renderCode || r1.render3d)), r1 && (r1.renderCode ? "renderCode" : "render3d"));
  await shot(TAG + "_correct_note.png");
  await ev("document.getElementById('rbKeep').click();1");
  ok("存为新版本 v2", await until("SolverDebug.review()===null && SolverDebug.versions().list.length===2", 10000, 150));
  let rec = await ev("fetch('/api/store/record/'+encodeURIComponent(SolverDebug.recId())).then(function(r){return r.json()})");
  ok("记录与 v2 快照带溯源", !!(rec && rec.givenAnswer === given1 && rec.answerAdjusted === false && rec.versions && rec.versions[1] && rec.versions[1].givenAnswer === given1));
  info("v2 图形", rec && rec.versions && rec.versions[1] ? (rec.versions[1].render3d ? "3D" : "2D") + " / " + String(rec.versions[1].renderCode || "").length + "B" : "");

  console.log("\n=== C. 给定冲突答案（" + NEG + "°）===");
  await ev("document.getElementById('ansEditBtn').click();1");
  const given2 = BAD;
  const t2 = Date.now();
  await ev("document.getElementById('ansEditIn').value=" + JSON.stringify(given2) + ";document.getElementById('ansEditIn').dispatchEvent(new Event('input'));document.getElementById('ansRedraw').click();1");
  ok("冲突结果待确认", await until("!!SolverDebug.review()", 300000, 500));
  info("耗时", ((Date.now() - t2) / 1000).toFixed(1) + "s");
  const r2 = await ev("SolverDebug.last().result");
  ok("answerAdjusted=true", r2 && r2.answerAdjusted === true, r2 && String(r2.answerAdjusted));
  ok("answerNote 非空", !!(r2 && r2.answerNote), clip(r2 && r2.answerNote, 240));
  info("冲突后答案", clip(r2 && r2.answer, 240));
  ok("保留正确 " + NUM + "° 且未采纳 " + NEG + "°", r2 && String(r2.answer).indexOf(NUM) >= 0 && String(r2.answer).indexOf(NEG) < 0, clip(r2 && r2.answer, 160));
  ok("提示切到警示样式", await ev("(function(){var n=document.getElementById('ansNote');return getComputedStyle(n).display!=='none'&&n.className.indexOf('warn')>=0&&n.textContent.indexOf('不一致')>=0;})()"),
    clip(await ev("document.getElementById('ansNote').textContent"), 220));
  await shot(TAG + "_conflict.png");
  await ev("document.getElementById('rbRevert').click();1");
  ok("撤销回 v2", await until("SolverDebug.review()===null && SolverDebug.versions().currentVid===2", 10000, 150));
  ok("撤销后仍是 2 版", await ev("SolverDebug.versions().list.length===2"));

  console.log("\n=== D. 刷新重开记录 ===");
  await send("Page.reload");
  await until(ready, 30000, 200);
  await until("document.querySelectorAll('#histList .hist-item').length>=1", 10000, 300);
  await ev("document.querySelector('#histList .hist-item').click();1");
  ok("重开同一记录", await until("SolverDebug.recId()===" + JSON.stringify(recId), 10000, 200));
  await sleep(500);
  ok("溯源提示恢复", await ev("getComputedStyle(document.getElementById('ansNote')).display!=='none' && document.getElementById('ansNote').textContent.indexOf('已按你给的')>=0"),
    clip(await ev("document.getElementById('ansNote').textContent"), 160));
  ok("改答案按钮可用", await ev("document.getElementById('ansEditBtn').disabled===false && document.getElementById('ansEditBtn').textContent==='改答案'"));
  await shot(TAG + "_persist.png");

  const realErrs = pageErrs.filter((x) => !/favicon/i.test(String(x)));
  ok("页面无 JS 异常", realErrs.length === 0, realErrs.slice(0, 2).join(" | "));
  console.log("\n----------------------------------------");
  if (fails) { console.log("结果：有 " + fails + " 项失败"); process.exit(1); }
  console.log("结果：全部通过");
  process.exit(0);
})().catch((e) => { console.log("FATAL " + (e && e.stack || e)); process.exit(1); });
