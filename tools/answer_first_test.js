// 「未解题先给答案」自检：输入区先填答案 → 解题时按这个答案画图、写解析
// 用法: node tools\answer_first_test.js
//
// 完全隔离：自己起 serve(8121) + mock(8120)，USERPROFILE 指到临时目录，
// 不读写真实的 ~/.hegy 与 Documents\Hegy；结束自动清理进程。
//
// 覆盖：
//   A. 输入区默认折叠；点开才出现答案框（不占版面）
//   B. 带答案解题：结果带 givenAnswer / givenAtSolve，答案卡旁提示「已按你给的答案生成图形与解析」
//   C. 提交后输入区被消费掉（清空 + 收起），不会带到下一题
//   D. 刷新后重开记录：溯源提示与字段仍在
//   E. 冲突答案：answerAdjusted=true、警示样式、以验算结果为准
//   F. 不填答案照常解题：不出现提示、记录里没有 givenAnswer
//   G. 服务端拦截超长与代码注入
//   H. 页面无 JS 异常
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const EPORT = 9443, SPORT = 8121, MPORT = 8120;
const APP = "http://127.0.0.1:" + SPORT + "/solver/index.html";
const API = "http://127.0.0.1:" + SPORT;
const HOME = path.join(os.tmpdir(), "hegy-ans-first-" + process.pid);
const SHOTS = path.join(__dirname, "shots_new");
const CFG = { baseUrl: "http://127.0.0.1:" + MPORT + "/v1", apiKey: "mock", model: "mock", temperature: 0.2 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (n, c, x) => { if (c) console.log("  ok   " + n + (x ? "  [" + x + "]" : "")); else { console.log("  FAIL " + n + (x ? "  [" + x + "]" : "")); fails++; } };

let edgeProc = null, serveProc = null, mockProc = null;
function killTree(p) { if (p && p.pid) { try { execSync("taskkill /pid " + p.pid + "/t /f", { stdio: "ignore" }); } catch (e) {} } }
function cleanup() {
  killTree(edgeProc); killTree(serveProc); killTree(mockProc);
  try { fs.rmSync(HOME, { recursive: true, force: true }); } catch (e) {}
}
process.on("exit", cleanup);

async function waitHttp(url, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.ok) return true; } catch (e) {}
    await sleep(200);
  }
  return false;
}
const apiPost = async (p, b) => (await fetch(API + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b || {}) })).json();

const Q = "如图，AD 平分∠BAC，F 是射线 DA 上一点，过 F 作 FE⊥BC 于 E。若∠B=40°，∠C=60°，求∠DFE。";

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.mkdirSync(HOME, { recursive: true });
  const env = Object.assign({}, process.env, { USERPROFILE: HOME, HOME: HOME });
  mockProc = spawn(process.execPath, [path.join(ROOT, "solver", "mock.js"), String(MPORT)], { env, stdio: "ignore" });
  serveProc = spawn(process.execPath, [path.join(ROOT, "solver", "serve.js"), String(SPORT)], { env, stdio: "ignore" });
  if (!(await waitHttp(API + "/api/status", 15000))) throw new Error("测试服务未启动");
  if (!(await waitHttp("http://127.0.0.1:" + MPORT + "/v1/models", 15000))) throw new Error("mock 未启动");

  edgeProc = spawn(EDGE, ["--headless=new", "--remote-debugging-port=" + EPORT,
    "--user-data-dir=" + path.join(os.tmpdir(), "edge-ans-first-" + process.pid),
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
  const until = async (expr, ms, step) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await ev(expr).catch(() => false); if (v) return v; await sleep(step || 200); } return false; };
  const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); if (r.result && r.result.data) fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.result.data, "base64")); };
  const ready = "!!(window.mathHTML && window.SolverDebug && document.getElementById('ansPreToggle') && document.getElementById('ansPreBody'))";

  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 950, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: APP });
  await until(ready, 30000, 200);
  await apiPost("/api/cfg", { config: CFG });
  await apiPost("/api/store/dir", { dir: path.join(HOME, "data"), migrate: false });
  await apiPost("/api/store/purge", {});
  await ev("localStorage.setItem('solver_cfg_v1', JSON.stringify(" + JSON.stringify(CFG) + "));['solver_dim_v1','solver_grade_v1','solver_refine_opts_v1','solver_refine_prefs_v1','solver_refine_draft_v1','solver_tasks_v1','solver_chat_open_v1'].forEach(function(k){localStorage.removeItem(k);});1");
  await send("Page.reload");
  await until(ready, 30000, 200);

  console.log("\n=== A. 输入区：默认折叠，点开才出现 ===");
  ok("答案框默认隐藏", await ev("document.getElementById('ansPreBody').hidden===true"));
  ok("入口文案是「已有答案？先填上」", /已有答案/.test(await ev("document.getElementById('ansPreTxt').textContent")),
    await ev("document.getElementById('ansPreTxt').textContent"));
  ok("折叠时只占一行（高度 < 40px）", (await ev("document.getElementById('ansPre').getBoundingClientRect().height")) < 40,
    String(await ev("document.getElementById('ansPre').getBoundingClientRect().height")));
  await ev("document.getElementById('ansPreToggle').click();1");
  ok("点开后答案框可见", await ev("document.getElementById('ansPreBody').hidden===false"));
  ok("展开后 aria-expanded=true", await ev("document.getElementById('ansPreToggle').getAttribute('aria-expanded')==='true'"));
  ok("有输入框 + 上传 + 清除", await ev("!!document.getElementById('ansPreIn') && !!document.getElementById('ansPrePick') && !!document.getElementById('ansPreClear')"));
  await shot("feature_answer_first_open.png");

  console.log("\n=== B. 带答案解题 ===");
  const given1 = "∠DFE = 12°（未解题先给答案）";
  await ev("document.getElementById('q').value=" + JSON.stringify(Q) + ";document.getElementById('ansPreIn').value=" + JSON.stringify(given1) + ";document.getElementById('ansPreIn').dispatchEvent(new Event('input'));1");
  ok("填完入口显示摘要", /已填答案/.test(await ev("document.getElementById('ansPreTxt').textContent")),
    await ev("document.getElementById('ansPreTxt').textContent"));
  await ev("document.getElementById('go').click();1");
  ok("解题完成", await until("(function(){var L=SolverDebug.last();return !!(L&&L.result&&L.result.givenAtSolve);})()", 40000, 200));
  await until("SolverDebug.tasks().filter(function(t){return t.status==='running';}).length===0", 8000, 200);
  await sleep(400);
  const r1 = await ev("SolverDebug.last().result");
  ok("结果带 givenAnswer", r1 && r1.givenAnswer === given1, r1 && r1.givenAnswer);
  ok("标记 givenAtSolve", r1 && r1.givenAtSolve === true);
  ok("不是微调结果", r1 && r1.refined !== true);
  ok("answerAdjusted=false", r1 && r1.answerAdjusted === false);
  ok("答案用的是给定内容", r1 && String(r1.answer).indexOf("12°") >= 0, r1 && String(r1.answer).slice(0, 40));
  ok("图形仍是 2D（答案段没干扰通道判断）", r1 && !!r1.renderCode && !r1.render3d);
  ok("答案卡旁提示为「生成」口径", await ev("(function(){var n=document.getElementById('ansNote');return getComputedStyle(n).display!=='none'&&n.className.indexOf('ok')>=0&&n.textContent.indexOf('已按你给的答案生成图形与解析')>=0;})()"),
    await ev("document.getElementById('ansNote').textContent"));
  await shot("feature_answer_first_note.png");

  console.log("\n=== C. 提交后输入区被消费掉 ===");
  ok("答案框已清空", (await ev("document.getElementById('ansPreIn').value")) === "");
  ok("答案框已收起", await ev("document.getElementById('ansPreBody').hidden===true"));
  ok("入口回到「先填上」文案", /已有答案/.test(await ev("document.getElementById('ansPreTxt').textContent")),
    await ev("document.getElementById('ansPreTxt').textContent"));

  console.log("\n=== D. 刷新后重开记录：溯源仍在 ===");
  const recId = await ev("SolverDebug.recId()");
  ok("有记录 id", !!recId, recId || "");
  let rec = await ev("fetch('/api/store/record/'+encodeURIComponent(SolverDebug.recId())).then(function(r){return r.json()})");
  ok("记录顶层带 givenAnswer", rec && rec.givenAnswer === given1, rec && rec.givenAnswer);
  ok("记录顶层带 givenAtSolve", rec && rec.givenAtSolve === true);
  await send("Page.reload");
  await until(ready, 30000, 200);
  await until("document.querySelectorAll('#histList .hist-item').length>=1", 10000, 200);
  await ev("document.querySelector('#histList .hist-item').click();1");
  ok("重开同一条记录", await until("SolverDebug.recId()===" + JSON.stringify(recId), 10000, 150));
  await sleep(400);
  ok("重开后提示仍在", await ev("getComputedStyle(document.getElementById('ansNote')).display!=='none' && document.getElementById('ansNote').textContent.indexOf('已按你给的答案生成图形与解析')>=0"),
    await ev("document.getElementById('ansNote').textContent"));

  console.log("\n=== E. 冲突答案：以验算结果为准 ===");
  await ev("document.getElementById('ansPreToggle').click();1");
  await ev("document.getElementById('ansPreIn').value='冲突答案：∠DFE = 99°';document.getElementById('ansPreIn').dispatchEvent(new Event('input'));document.getElementById('go').click();1");
  ok("冲突结果落地", await until("(function(){var L=SolverDebug.last();return !!(L&&L.result&&L.result.givenAtSolve&&L.result.answerAdjusted);})()", 40000, 200));
  await until("SolverDebug.tasks().filter(function(t){return t.status==='running';}).length===0", 8000, 200);
  await sleep(400);
  const r2 = await ev("SolverDebug.last().result");
  ok("answerAdjusted=true", r2 && r2.answerAdjusted === true);
  ok("answerNote 说明冲突", r2 && /矛盾|不一致|纠正/.test(r2.answerNote || ""), r2 && r2.answerNote);
  ok("答案没有被 99° 覆盖", r2 && String(r2.answer).indexOf("99") < 0, r2 && String(r2.answer).slice(0, 40));
  ok("提示切到警示样式", await ev("(function(){var n=document.getElementById('ansNote');return getComputedStyle(n).display!=='none'&&n.className.indexOf('warn')>=0;})()"),
    await ev("document.getElementById('ansNote').textContent"));
  await shot("feature_answer_first_conflict.png");

  console.log("\n=== F. 不填答案照常解题 ===");
  ok("冲突那次也已清空", (await ev("document.getElementById('ansPreIn').value")) === "");
  await ev("document.getElementById('q').value=" + JSON.stringify(Q) + ";document.getElementById('go').click();1");
  ok("普通解题完成", await until("(function(){var L=SolverDebug.last();return !!(L&&L.result&&L.result.answer&&!L.result.givenAtSolve);})()", 40000, 200));
  await until("SolverDebug.tasks().filter(function(t){return t.status==='running';}).length===0", 8000, 200);
  await sleep(300);
  ok("普通解题不显示溯源提示", await ev("getComputedStyle(document.getElementById('ansNote')).display==='none'"));
  const rPlain = await ev("SolverDebug.last().result");
  ok("普通解题没有 givenAnswer", rPlain && rPlain.givenAnswer === undefined && !rPlain.givenAtSolve);

  console.log("\n=== G. 服务端输入校验 ===");
  const post = async (given) => {
    const r = await fetch(API + "/api/solve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "q", givenAnswer: given, config: CFG, stream: false }) });
    return r.status;
  };
  ok("超长给定答案返回 400", (await post("a".repeat(4001))) === 400);
  ok("代码注入给定答案返回 400", (await post("```<script>x</script>")) === 400);

  console.log("\n=== H. 手机宽度：文案换成「也可上传答案截图」 ===");
  // 桌面上写「也可以粘贴或上传答案截图」；手机 WebView 贴不了图，mobile-ui.js 会换一套文案
  ok("桌面 placeholder 提粘贴", (await ev("document.getElementById('ansPreIn').getAttribute('placeholder')")).indexOf("也可以粘贴或上传答案截图") >= 0);
  ok("桌面按钮是「上传截图」", (await ev("document.getElementById('ansPrePickTxt').textContent")) === "上传截图");
  await send("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
  const OV = path.join(ROOT, "mobile", "src", "overlay");
  await ev("(function(){var s=document.createElement('style');s.textContent=" + JSON.stringify(fs.readFileSync(path.join(OV, "mobile.css"), "utf8")) + ";document.head.appendChild(s);return 1;})()");
  await ev(fs.readFileSync(path.join(OV, "mobile-ui.js"), "utf8") + "\n;'ok'");
  await sleep(600);
  const mPh = await ev("document.getElementById('ansPreIn').getAttribute('placeholder')");
  ok("手机 placeholder 改成「也可上传答案截图」", /也可上传答案截图$/.test(mPh), mPh);
  ok("手机 placeholder 不再提粘贴", mPh.indexOf("粘贴") < 0);
  ok("手机按钮是「上传答案截图」", (await ev("document.getElementById('ansPrePickTxt').textContent")) === "上传答案截图");
  await shot("feature_answer_first_mobile_copy.png");
  await send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 950, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  ok("回到桌面宽度文案还原", (await ev("document.getElementById('ansPreIn').getAttribute('placeholder')")).indexOf("也可以粘贴或上传答案截图") >= 0);
  ok("回到桌面宽度按钮还原", (await ev("document.getElementById('ansPrePickTxt').textContent")) === "上传截图");

  const realErrs = pageErrs.filter((x) => !/favicon/i.test(String(x)));
  ok("页面无 JS 异常", realErrs.length === 0, realErrs.slice(0, 2).join(" | "));

  console.log("\n----------------------------------------");
  if (fails) { console.log("结果：有 " + fails + " 项失败"); process.exit(1); }
  console.log("结果：全部通过");
  process.exit(0);
})().catch((e) => { console.log("FATAL " + (e && e.stack || e)); process.exit(1); });
