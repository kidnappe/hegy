// §59 改答案区「粘贴答案截图 → 点重画时才由模型读图」自检
// 用法: node tools\answer_image_test.js
//
// 完全隔离：自己起 serve(8123) + mock(8122)，USERPROFILE 指到临时目录，
// 不读写真实的 ~/.hegy 与 Documents\Hegy；结束自动清理进程。
//
// 口径（2026-10-20 晚按用户要求改）：
//   粘贴只挂缩略图，**不发起任何请求**；点「按此答案重画」时才把图随 refine 发给模型，
//   模型读图后把识别到的原文写进 givenAnswerText，再按【给定答案使用规则】验算重画。
//
// 覆盖：
//   A. 粘贴 → 出现缩略图 + 提示，且不产生任何任务/请求
//   B. 只贴图不写文字 → 可以直接重画；结果带 givenFromImage/givenAnswerText，提示说明来自图片
//   C. 文字 + 图片同时给 → 文字优先
//   D. 「移除」清空缩略图
//   E. 服务端校验：answerImages 非 dataURL / 伪图片 → 400
//   F. 窄窗口 900×800 缩略条不撑破布局
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const EPORT = 9445, SPORT = 8123, MPORT = 8122;
const APP = "http://127.0.0.1:" + SPORT + "/solver/index.html";
const API = "http://127.0.0.1:" + SPORT;
const HOME = path.join(os.tmpdir(), "hegy-ans-img-" + process.pid);
const SHOTS = path.join(__dirname, "shots_new");
const CFG = { baseUrl: "http://127.0.0.1:" + MPORT + "/v1", apiKey: "mock", model: "mock", temperature: 0.2 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (n, c, x) => { if (c) console.log("  ok   " + n + (x ? "  [" + x + "]" : "")); else { console.log("  FAIL " + n + (x ? "  [" + x + "]" : "")); fails++; } };
const info = (n, x) => console.log("  info " + n + (x != null ? "  [" + x + "]" : ""));

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

// 在页面里造一张 ≥10KB 的噪点图并派发 paste 事件（模拟 Ctrl+V / 右键粘贴图片）
const PASTE_FN = `
window.__pasteImage = function (sel) {
  return new Promise(function (resolve, reject) {
    var c = document.createElement('canvas');
    c.width = 320; c.height = 140;
    var g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    for (var i = 0; i < 9000; i++) {
      g.fillStyle = 'rgb(' + (i * 37 % 255) + ',' + (i * 71 % 255) + ',' + (i * 113 % 255) + ')';
      g.fillRect(Math.random() * c.width | 0, Math.random() * c.height | 0, 2, 2);
    }
    g.fillStyle = '#000'; g.font = '20px sans-serif'; g.fillText('answer: 10 degree', 16, 70);
    c.toBlob(function (blob) {
      if (!blob) return reject(new Error('toBlob failed'));
      var f = new File([blob], 'answer.png', { type: 'image/png' });
      var dt = new DataTransfer();
      dt.items.add(f);
      var el = document.querySelector(sel);
      var evt;
      try { evt = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); }
      catch (e) { evt = new Event('paste', { bubbles: true, cancelable: true }); evt.clipboardData = dt; }
      el.dispatchEvent(evt);
      resolve({ size: blob.size, type: blob.type });
    }, 'image/png');
  });
};
1`;

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.mkdirSync(HOME, { recursive: true });
  const env = Object.assign({}, process.env, { USERPROFILE: HOME, HOME: HOME });
  mockProc = spawn(process.execPath, [path.join(ROOT, "solver", "mock.js"), String(MPORT)], { env, stdio: "ignore" });
  serveProc = spawn(process.execPath, [path.join(ROOT, "solver", "serve.js"), String(SPORT)], { env, stdio: "ignore" });
  if (!(await waitHttp(API + "/api/status", 15000))) throw new Error("测试服务未启动");
  if (!(await waitHttp("http://127.0.0.1:" + MPORT + "/v1/models", 15000))) throw new Error("mock 未启动");

  console.log("\n=== E. 服务端校验 answerImages ===");
  const bad = { instruction: "按用户给定答案重新生成完整解答与图形", previous: { answer: "x" }, answerImages: ["http://example.com/a.png"] };
  const e1 = await fetch(API + "/api/refine", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(bad) });
  const j1 = await e1.json();
  ok("非 dataURL 的答案图被拒", e1.status === 400 && j1.error === "BAD_IMAGE", JSON.stringify(j1));
  const bad2 = Object.assign({}, bad, { answerImages: ["data:image/png;base64,AAAA"] });
  const e2 = await fetch(API + "/api/refine", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(bad2) });
  const j2 = await e2.json();
  ok("伪图片被拒", e2.status === 400 && j2.error === "BAD_IMAGE", JSON.stringify(j2));

  edgeProc = spawn(EDGE, ["--headless=new", "--remote-debugging-port=" + EPORT,
    "--user-data-dir=" + path.join(os.tmpdir(), "edge-ans-img-" + process.pid),
    "--no-first-run", "--no-default-browser-check", "--disable-gpu", "about:blank"], { stdio: "ignore" });
  let ver = null;
  for (let i = 0; i < 80; i++) { try { ver = await (await fetch("http://127.0.0.1:" + EPORT + "/json/version")).json(); break; } catch (e) { await sleep(250); } }
  if (!ver) throw new Error("no devtools");
  const tab = await (await fetch("http://127.0.0.1:" + EPORT + "/json/new?about:blank", { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const pageErrs = [];
  ws.addEventListener("message", (evt) => {
    const m = JSON.parse(evt.data);
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
  const ready = "!!(window.SolverDebug && document.getElementById('ansEditBtn') && document.getElementById('ansImgBox'))";

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
  await ev(PASTE_FN);

  console.log("\n=== A. 粘贴只挂缩略图，不发请求 ===");
  await ev("document.getElementById('q').value='如图，AD 平分∠BAC，F 是射线 DA 上一点，过 F 作 FE⊥BC 于 E。若∠B=40°，∠C=60°，求∠DFE。';document.getElementById('go').click();1");
  ok("解题完成", await until("(function(){var L=SolverDebug.last();return !!(L&&L.result&&document.getElementById('answer').textContent.indexOf('关键结论')>=0);})()", 40000, 200));
  await until("SolverDebug.tasks().filter(function(t){return t.status==='running';}).length===0", 8000, 200);
  await sleep(300);
  await ev("document.getElementById('ansEditBtn').click();1");
  ok("编辑器打开", await ev("SolverDebug.ansEdit().open===true"));
  const tasksBefore = await ev("SolverDebug.tasks().length");
  const pasted = await ev("window.__pasteImage('#ansEditIn')");
  info("合成图片", pasted && (pasted.size + "B"));
  ok("出现答案图缩略条", await until("getComputedStyle(document.getElementById('ansImgBox')).display!=='none'", 8000, 100));
  ok("缩略图是 dataURL", String(await ev("document.getElementById('ansImgThumb').src")).indexOf("data:image") === 0);
  ok("缩略条说明「点重画时才识别」", /重画时由 AI 识别/.test(await ev("document.querySelector('#ansImgBox .ans-img-cap').textContent")),
    await ev("document.querySelector('#ansImgBox .ans-img-cap').textContent"));
  await sleep(1200);
  ok("粘贴不新增任务", (await ev("SolverDebug.tasks().length")) === tasksBefore, tasksBefore + " → " + (await ev("SolverDebug.tasks().length")));
  ok("答案文字未被改动", (await ev("document.getElementById('ansEditIn').value")).indexOf("关键结论") >= 0);
  ok("/api/ocr 已移除（404）", (await fetch(API + "/api/ocr", { method: "POST", body: "{}" })).status === 404);
  await shot("feature_ans_img_attached.png");

  console.log("\n=== B. 只贴图也能重画，结果标明来自图片 ===");
  await ev("var ta=document.getElementById('ansEditIn');ta.value='';ta.dispatchEvent(new Event('input'));document.getElementById('ansRedraw').click();1");
  ok("没有报「请先填写答案」", (await ev("document.getElementById('status').textContent")).indexOf("请先填写答案") < 0,
    await ev("document.getElementById('status').textContent"));
  ok("重画待确认", await until("!!SolverDebug.review()", 40000, 150));
  const r1 = await ev("SolverDebug.last().result");
  ok("givenFromImage=true", r1 && r1.givenFromImage === true);
  ok("givenAnswerText 是识别原文", r1 && /mock 识别/.test(r1.givenAnswerText || ""), r1 && String(r1.givenAnswerText || "").slice(0, 30));
  ok("givenAnswer 用识别文本兜底", r1 && r1.givenAnswer === r1.givenAnswerText, r1 && String(r1.givenAnswer || "").slice(0, 24));
  ok("作用域整题", r1 && r1.givenScope === "all");
  ok("提示说明来自上传的图片", await ev("(function(){var n=document.getElementById('ansNote');return getComputedStyle(n).display!=='none'&&n.textContent.indexOf('你上传的答案图片')>=0;})()"),
    await ev("document.getElementById('ansNote').textContent"));
  ok("提示里带「图片识别为」", (await ev("document.getElementById('ansNote').textContent")).indexOf("图片识别为") >= 0);
  await shot("feature_ans_img_note.png");

  await ev("document.getElementById('rbKeep').click();1");
  ok("存为新版本", await until("SolverDebug.review()===null && SolverDebug.versions().list.length===2", 8000, 100));
  const rec = await ev("fetch('/api/store/record/'+encodeURIComponent(SolverDebug.recId())).then(function(r){return r.json()})");
  ok("记录顶层带 givenFromImage", rec && rec.givenFromImage === true);
  ok("v2 快照带 givenAnswerText", rec && rec.versions && rec.versions[1] && /mock 识别/.test(rec.versions[1].givenAnswerText || ""));

  console.log("\n=== B2. 「全部」答案按小问分块 + 点击跳转 ===");
  ok("全部视图有 3 个分问块", await ev("document.querySelectorAll('#answer .ans-blk').length===3"),
    String(await ev("document.querySelectorAll('#answer .ans-blk').length")));
  ok("每块带 (n) 标签", /^\(1\)/.test(await ev("document.querySelector('#answer .ans-blk .ana-tag').textContent")),
    await ev("document.querySelector('#answer .ans-blk .ana-tag').textContent"));
  await ev("document.querySelectorAll('#answer .ans-blk')[1].click();1");
  ok("点第 2 块跳到第(2)问", await until("(function(){var b=document.querySelector('#subTabs .on');return !!b&&b.textContent.indexOf('(2)')>=0;})()", 4000, 100),
    await ev("(document.querySelector('#subTabs .on')||{}).textContent"));
  ok("单问视图不再显示分块", await ev("document.querySelectorAll('#answer .ans-blk').length===0"));
  await ev("document.querySelectorAll('#subTabs button')[0].click();1");
  ok("回到全部又是 3 块", await ev("document.querySelectorAll('#answer .ans-blk').length===3"));

  console.log("\n=== G. 导出页同样按小问分块 ===");
  await ev("window.__exp=null;(function(){var _c=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){window.__exp=this.href;};return 1;})()");
  await ev("document.getElementById('btnHtml').click();1");
  ok("拿到离线 HTML", await until("!!window.__exp", 60000, 300));
  const expHas = await ev("fetch(window.__exp).then(function(r){return r.text()}).then(function(t){return {f:t.indexOf('ansAllHTML')>=0,c:t.indexOf('ans-blk')>=0};})", 60000);
  ok("导出内联了 ansAllHTML", expHas && expHas.f === true);
  ok("导出含 ans-blk 样式/结构", expHas && expHas.c === true);

  console.log("\n=== C. 文字 + 图片：文字优先 ===");
  await ev("document.getElementById('ansEditBtn').click();1");
  const typed = "∠DFE = 12°（我手打的）";
  await ev("var ta=document.getElementById('ansEditIn');ta.value=" + JSON.stringify(typed) + ";ta.dispatchEvent(new Event('input'));1");
  await ev("window.__pasteImage('#ansEditIn')");
  await until("getComputedStyle(document.getElementById('ansImgBox')).display!=='none'", 8000, 100);
  await ev("document.getElementById('ansRedraw').click();1");
  ok("重画待确认（文字+图）", await until("!!SolverDebug.review()", 40000, 150));
  const r2 = await ev("SolverDebug.last().result");
  ok("givenAnswer 用文字", r2 && r2.givenAnswer === typed, r2 && String(r2.givenAnswer || ""));
  ok("仍标记来自图片", r2 && r2.givenFromImage === true);
  ok("givenAnswerText 仍有识别原文", r2 && /mock 识别/.test(r2.givenAnswerText || ""));
  await ev("document.getElementById('rbRevert').click();1");
  await until("SolverDebug.review()===null", 8000, 100);

  console.log("\n=== D. 移除按钮 ===");
  await ev("document.getElementById('ansEditBtn').click();1");
  await ev("window.__pasteImage('#ansEditIn')");
  await until("getComputedStyle(document.getElementById('ansImgBox')).display!=='none'", 8000, 100);
  await ev("document.getElementById('ansImgDel').click();1");
  ok("移除后缩略条隐藏", await ev("getComputedStyle(document.getElementById('ansImgBox')).display==='none'"));
  ok("移除后提示清空", await ev("getComputedStyle(document.getElementById('ansImgHint')).display==='none'"));
  await ev("document.getElementById('ansEditCancel').click();1");

  console.log("\n=== F. 窄窗口 900×800 ===");
  await send("Emulation.setDeviceMetricsOverride", { width: 900, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  await ev("document.getElementById('ansEditBtn').click();1");
  await ev("window.__pasteImage('#ansEditIn')");
  await until("getComputedStyle(document.getElementById('ansImgBox')).display!=='none'", 8000, 100);
  const layout = await ev("(function(){var b=document.getElementById('ansImgBox');var r=b.getBoundingClientRect();var p=b.parentNode.getBoundingClientRect();return {boxW:Math.round(r.width),rowW:Math.round(p.width),overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};})()");
  ok("缩略条不超出编辑器宽度", layout && layout.boxW <= layout.rowW + 1, JSON.stringify(layout));
  ok("页面无横向溢出", layout && layout.overflow === false);
  await shot("feature_ans_img_900.png");
  await ev("document.getElementById('ansEditCancel').click();1");

  ok("页面无 JS 异常", pageErrs.length === 0, pageErrs.slice(0, 2).join(" | "));

  console.log("\n" + (fails ? "RESULT: " + fails + " failed" : "RESULT: all passed"));
  ws.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
