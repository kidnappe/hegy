// §58 答案校准重画自检：改答案 → 按此答案重画
// 用法: node tools\answer_redraw_test.js
//
// 完全隔离：自己起 serve(8119) + mock(8118)，USERPROFILE 指到临时目录，
// 不读写真实的 ~/.hegy 与 Documents\Hegy；结束自动清理进程。
//
// 覆盖：
//   A. 解题后答案卡出现「改答案」，预填当前答案
//   B. 整题重画：待确认 → 提示「已按你的答案」 → 存为新版本（含溯源字段）
//   C. 冲突答案：answerAdjusted=true、警示说明、原答案保留、撤销可回退
//   D. 小问范围：只改第 (2) 问，版本标签与记录都标明范围
//   E. 刷新/重开记录/切版本：溯源提示与字段仍正确
//   F. 普通微调不受影响（不带 givenAnswer、不显示提示）
//   G. 导出离线 HTML 内含 givenAnswer/answerAdjusted
//   H. 服务端拦截超长与代码注入
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const EPORT = 9441, SPORT = 8119, MPORT = 8118;
const APP = "http://127.0.0.1:" + SPORT + "/solver/index.html";
const API = "http://127.0.0.1:" + SPORT;
const HOME = path.join(os.tmpdir(), "hegy-ans-redraw-" + process.pid);
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

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.mkdirSync(HOME, { recursive: true });
  const env = Object.assign({}, process.env, { USERPROFILE: HOME, HOME: HOME });
  mockProc = spawn(process.execPath, [path.join(ROOT, "solver", "mock.js"), String(MPORT)], { env, stdio: "ignore" });
  serveProc = spawn(process.execPath, [path.join(ROOT, "solver", "serve.js"), String(SPORT)], { env, stdio: "ignore" });
  if (!(await waitHttp(API + "/api/status", 15000))) throw new Error("测试服务未启动");
  if (!(await waitHttp("http://127.0.0.1:" + MPORT + "/v1/models", 15000))) throw new Error("mock 未启动");

  edgeProc = spawn(EDGE, ["--headless=new", "--remote-debugging-port=" + EPORT,
    "--user-data-dir=" + path.join(os.tmpdir(), "edge-ans-redraw-" + process.pid),
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
  const ready = "!!(window.mathHTML && window.SolverDebug && document.getElementById('ansEditBtn') && document.getElementById('ansNote'))";

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

  console.log("\n=== A. 解题后出现「改答案」 ===");
  await ev("document.getElementById('q').value='如图，AD 平分∠BAC，F 是射线 DA 上一点，过 F 作 FE⊥BC 于 E。若∠B=40°，∠C=60°，求∠DFE。';document.getElementById('go').click();1");
  ok("解题完成", await until("(function(){var L=SolverDebug.last();return !!(L&&L.result&&document.getElementById('answer').textContent.indexOf('关键结论')>=0);})()", 40000, 200));
  await until("SolverDebug.tasks().filter(function(t){return t.status==='running';}).length===0", 8000, 200);
  await sleep(400);
  const recId = await ev("SolverDebug.recId()");
  ok("有记录 id", !!recId, recId || "");
  ok("答案卡有「改答案」", await ev("getComputedStyle(document.getElementById('ansEditBtn')).display!=='none' && document.getElementById('ansEditBtn').textContent==='改答案'"));
  ok("出现 3 个小问 + 全部标签", await ev("document.querySelectorAll('#subTabs button').length===4"));
  ok("初始无溯源提示", await ev("getComputedStyle(document.getElementById('ansNote')).display==='none'"));

  const rawAnswer = await ev("SolverDebug.last().result.answer");
  await ev("document.getElementById('ansEditBtn').click();1");
  ok("编辑器打开", await ev("SolverDebug.ansEdit().open===true"));
  ok("预填当前答案", (await ev("document.getElementById('ansEditIn').value")) === rawAnswer);
  ok("提示为整题重画", /整题/.test(await ev("document.getElementById('ansEditHint').textContent")));
  await shot("feature_answer_edit.png");

  console.log("\n=== B. 整题：按给定答案重画 ===");
  const given1 = "∠DFE = 12°（用户给定）";
  await ev("document.getElementById('ansEditIn').value=" + JSON.stringify(given1) + ";document.getElementById('ansEditIn').dispatchEvent(new Event('input'));document.getElementById('ansRedraw').click();1");
  ok("提交后编辑器关闭", await ev("document.getElementById('ansEdit').style.display==='none'"));
  ok("按钮进入重画中", await ev("document.getElementById('ansEditBtn').disabled===true && document.getElementById('ansEditBtn').textContent==='重画中…'"));
  ok("重画结果待确认", await until("!!SolverDebug.review()", 40000, 150), JSON.stringify(await ev("SolverDebug.review()")));
  const r1 = await ev("SolverDebug.last().result");
  ok("结果带 givenAnswer", r1 && r1.givenAnswer === given1, r1 && r1.givenAnswer);
  ok("作用域为整题", r1 && r1.givenScope === "all" && r1.givenQuestionIndex === -1, r1 && (r1.givenScope + "/" + r1.givenQuestionIndex));
  ok("未触发答案纠正", r1 && r1.answerAdjusted === false);
  ok("答案已按给定内容", r1 && String(r1.answer).indexOf("12°") >= 0, r1 && String(r1.answer).slice(0, 40));
  ok("提示为「已按你给的…」", await ev("(function(){var n=document.getElementById('ansNote');return getComputedStyle(n).display!=='none'&&n.className.indexOf('ok')>=0&&n.textContent.indexOf('已按你给的')>=0;})()"),
    await ev("document.getElementById('ansNote').textContent"));
  ok("待确认时版本仍为 1", await ev("SolverDebug.versions().list.length===1"));
  await shot("feature_answer_redraw_note.png");

  await ev("document.getElementById('rbKeep').click();1");
  ok("存为新版本", await until("SolverDebug.review()===null && SolverDebug.versions().list.length===2", 8000, 100));
  ok("版本抽屉有 2 版", await ev("document.getElementById('verCard').style.display!=='none'"));
  await ev("(function(){var c=document.getElementById('verCard');if(c&&!c.classList.contains('open'))document.getElementById('verToggle').click();return 1;})()");
  await sleep(300);
  ok("v2 标签含「按答案重画」", (await ev("document.querySelector('#verList .ver-item[data-vid=\"2\"]').textContent")).indexOf("按答案重画") >= 0,
    await ev("document.querySelector('#verList .ver-item[data-vid=\"2\"]').textContent"));
  let rec = await ev("fetch('/api/store/record/'+encodeURIComponent(SolverDebug.recId())).then(function(r){return r.json()})");
  ok("记录顶层带 givenAnswer", rec && rec.givenAnswer === given1);
  ok("v2 快照带 givenAnswer", rec && rec.versions && rec.versions[1] && rec.versions[1].givenAnswer === given1);
  ok("v2 快照带 answerAdjusted", rec && rec.versions && rec.versions[1] && rec.versions[1].answerAdjusted === false);

  console.log("\n=== C. 冲突答案：保留原答案并警示 ===");
  await ev("document.getElementById('ansEditBtn').click();1");
  const given2 = "冲突答案：∠DFE = 99°";
  await ev("document.getElementById('ansEditIn').value=" + JSON.stringify(given2) + ";document.getElementById('ansEditIn').dispatchEvent(new Event('input'));document.getElementById('ansRedraw').click();1");
  ok("冲突结果待确认", await until("!!SolverDebug.review()", 40000, 150));
  const r2 = await ev("SolverDebug.last().result");
  ok("answerAdjusted=true", r2 && r2.answerAdjusted === true);
  ok("answerNote 说明冲突", r2 && /矛盾|不一致|纠正/.test(r2.answerNote || ""), r2 && r2.answerNote);
  ok("原答案未被 99° 覆盖", r2 && String(r2.answer).indexOf("99") < 0 && String(r2.answer).indexOf("10") >= 0, r2 && String(r2.answer).slice(0, 50));
  ok("提示切到警示样式", await ev("(function(){var n=document.getElementById('ansNote');return getComputedStyle(n).display!=='none'&&n.className.indexOf('warn')>=0&&n.textContent.indexOf('不一致')>=0;})()"),
    await ev("document.getElementById('ansNote').textContent"));
  await shot("feature_answer_conflict.png");
  await ev("document.getElementById('rbRevert').click();1");
  ok("撤销后回到 v2", await until("SolverDebug.review()===null && SolverDebug.versions().currentVid===2", 8000, 100));
  ok("撤销后答案恢复", (await ev("document.getElementById('answer').textContent")).indexOf("12°") >= 0);
  ok("撤销未新增版本", await ev("SolverDebug.versions().list.length===2"));

  console.log("\n=== D. 小问范围：只改第 (2) 问 ===");
  await ev("([].slice.call(document.querySelectorAll('#subTabs button')).filter(function(b){return b.textContent.indexOf('(2)')>=0;})[0]).click();1");
  ok("切到第 (2) 问", (await ev("document.getElementById('subTabs').innerText")).indexOf("第(2)问") >= 0 || (await ev("document.getElementById('answer').textContent")).indexOf("mock 小问 2") >= 0);
  const sub2Before = await ev("SolverDebug.last().result.subQuestions[1].answer");
  await ev("document.getElementById('ansEditBtn').click();1");
  ok("预填第 (2) 问答案", (await ev("document.getElementById('ansEditIn').value")) === sub2Before);
  ok("提示为第 (2) 问", /第 \(2\) 问/.test(await ev("document.getElementById('ansEditHint').textContent")));
  const given3 = "∠DFE = 24°（第2问给定）";
  await ev("document.getElementById('ansEditIn').value=" + JSON.stringify(given3) + ";document.getElementById('ansEditIn').dispatchEvent(new Event('input'));document.getElementById('ansRedraw').click();1");
  ok("小问重画待确认", await until("!!SolverDebug.review()", 40000, 150));
  const r3 = await ev("SolverDebug.last().result");
  ok("作用域为第 2 问", r3 && r3.givenScope === "current" && r3.givenQuestionIndex === 1, r3 && (r3.givenScope + "/" + r3.givenQuestionIndex));
  ok("subQuestions[1] 已替换", r3 && r3.subQuestions && r3.subQuestions[1] && r3.subQuestions[1].answer === given3, r3 && r3.subQuestions && r3.subQuestions[1] && r3.subQuestions[1].answer);
  ok("提示标明第 (2) 问", (await ev("document.getElementById('ansNote').textContent")).indexOf("第 (2) 问") >= 0,
    await ev("document.getElementById('ansNote').textContent"));
  await ev("document.getElementById('rbKeep').click();1");
  ok("存为 v3", await until("SolverDebug.review()===null && SolverDebug.versions().list.length===3", 8000, 100));
  await ev("([].slice.call(document.querySelectorAll('#subTabs button')).filter(function(b){return b.textContent.indexOf('(2)')>=0;})[0]).click();1");
  await sleep(300);
  ok("第 2 问视图显示给定答案", (await ev("document.getElementById('answer').textContent")).indexOf("24°") >= 0, await ev("document.getElementById('answer').textContent"));
  await ev("(function(){var c=document.getElementById('verCard');if(c&&!c.classList.contains('open'))document.getElementById('verToggle').click();return 1;})()");
  await sleep(300);
  ok("v3 标签标明范围", (await ev("document.querySelector('#verList .ver-item[data-vid=\"3\"]').textContent")).indexOf("第 (2) 问") >= 0,
    await ev("document.querySelector('#verList .ver-item[data-vid=\"3\"]').textContent"));
  rec = await ev("fetch('/api/store/record/'+encodeURIComponent(SolverDebug.recId())).then(function(r){return r.json()})");
  ok("记录顶层带范围", rec && rec.givenScope === "current" && rec.givenQuestionIndex === 1, rec && (rec.givenScope + "/" + rec.givenQuestionIndex));
  ok("记录 v3 带范围", rec && rec.versions && rec.versions[2] && rec.versions[2].givenScope === "current" && rec.versions[2].givenQuestionIndex === 1);
  await shot("feature_answer_subscope.png");

  console.log("\n=== E. 刷新 / 重开记录 / 切版本 ===");
  await send("Page.reload");
  await until(ready, 30000, 200);
  await until("document.querySelectorAll('#histList .hist-item').length>=1", 10000, 200);
  await ev("document.querySelector('#histList .hist-item').click();1");
  ok("重开同一记录", await until("SolverDebug.recId()===" + JSON.stringify(recId), 10000, 150));
  await sleep(500);
  ok("溯源提示恢复", await ev("getComputedStyle(document.getElementById('ansNote')).display!=='none' && document.getElementById('ansNote').textContent.indexOf('第 (2) 问')>=0"),
    await ev("document.getElementById('ansNote').textContent"));
  ok("改动按钮恢复可用", await ev("document.getElementById('ansEditBtn').disabled===false && document.getElementById('ansEditBtn').textContent==='改答案'"));
  await ev("(function(){var c=document.getElementById('verCard');if(c&&!c.classList.contains('open'))document.getElementById('verToggle').click();return 1;})()");
  await sleep(300);
  await ev("document.querySelector('#verList .ver-item[data-vid=\"1\"] .ver-acts button').click();1");
  ok("切到 v1", await until("SolverDebug.versions().currentVid===1", 8000, 100));
  ok("v1 不显示溯源提示", await ev("getComputedStyle(document.getElementById('ansNote')).display==='none'"));
  await ev("(function(){var c=document.getElementById('verCard');if(c&&!c.classList.contains('open'))document.getElementById('verToggle').click();return 1;})()");
  await sleep(300);
  await ev("document.querySelector('#verList .ver-item[data-vid=\"3\"] .ver-acts button').click();1");
  ok("切回 v3", await until("SolverDebug.versions().currentVid===3", 8000, 100));
  ok("v3 溯源提示恢复", await ev("getComputedStyle(document.getElementById('ansNote')).display!=='none' && document.getElementById('ansNote').textContent.indexOf('第 (2) 问')>=0"));
  await shot("feature_answer_persist.png");

  console.log("\n=== F. 普通微调不受影响 ===");
  await ev("var t=document.getElementById('rtarget');t.value='text';t.dispatchEvent(new Event('change'));var r=document.getElementById('rin');r.value='解析再详细一点';r.dispatchEvent(new Event('input'));document.getElementById('btnRefine').click();1");
  ok("普通微调完成", await until("!!SolverDebug.review()", 40000, 150));
  const rf = await ev("SolverDebug.last().result");
  ok("普通微调不带 givenAnswer", rf && !rf.givenAnswer);
  ok("普通微调不显示溯源提示", await ev("getComputedStyle(document.getElementById('ansNote')).display==='none'"));
  ok("普通微调目标仍为 text", (await ev("SolverDebug.review() && SolverDebug.review().target")) === "text");
  await ev("document.getElementById('rbRevert').click();1");
  await until("SolverDebug.review()===null", 8000, 100);
  ok("普通微调撤销后仍 3 版", await ev("SolverDebug.versions().list.length===3"));

  console.log("\n=== F2. 窄窗口（900×800）：编辑器可用且不溢出 ===");
  await send("Emulation.setDeviceMetricsOverride", { width: 900, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  await ev("(document.querySelector('#subTabs button')||{click:function(){}}).click();1");
  await sleep(300);
  const mob = await ev("(function(){var d=document.documentElement;var e=document.getElementById('ansEditBtn');var r=e.getBoundingClientRect();return {sw:d.scrollWidth,iw:innerWidth,l:r.left,r:r.right};})()");
  ok("窄窗口页面无横向溢出", mob && mob.sw <= mob.iw + 1, mob && (mob.sw + "/" + mob.iw));
  ok("改答案按钮在视口内", mob && mob.l >= 0 && mob.r <= mob.iw + 1, mob && (mob.l.toFixed(0) + "~" + mob.r.toFixed(0)));
  await ev("document.getElementById('ansEditBtn').click();1");
  await sleep(300);
  const mob2 = await ev("(function(){var p=document.getElementById('ansEdit');var t=document.getElementById('ansEditIn');p.scrollIntoView({block:'center'});var pr=p.getBoundingClientRect();var tr=t.getBoundingClientRect();return {sw:document.documentElement.scrollWidth,iw:innerWidth,pl:pr.left,pr:pr.right,pw:pr.width,tl:tr.left,tr:tr.right};})()");
  ok("编辑器在视口内", mob2 && mob2.pl >= 0 && mob2.pr <= mob2.iw + 1, mob2 && (mob2.pl.toFixed(0) + "~" + mob2.pr.toFixed(0)));
  ok("编辑器宽度可用（≥220px）", mob2 && mob2.pw >= 220, mob2 && (mob2.pw.toFixed(0) + "px"));
  ok("文本框在视口内", mob2 && mob2.tl >= 0 && mob2.tr <= mob2.iw + 1, mob2 && (mob2.tl.toFixed(0) + "~" + mob2.tr.toFixed(0)));
  ok("打开编辑器后仍无横向溢出", mob2 && mob2.sw <= mob2.iw + 1, mob2 && (mob2.sw + "/" + mob2.iw));
  await sleep(200);
  await shot("feature_answer_edit_900.png");
  await ev("document.getElementById('ansEditCancel').click();1");
  await send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 950, deviceScaleFactor: 1, mobile: false });
  await sleep(300);

  console.log("\n=== G. 导出离线 HTML 带溯源字段 ===");
  await ev("window.__exp=null;(function(){var _c=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){window.__exp=this.href;};return 1;})()");
  await ev("document.getElementById('btnHtml').click();1");
  ok("拿到离线 HTML", await until("!!window.__exp", 60000, 300));
  const expFlags = await ev("fetch(window.__exp).then(function(r){return r.text()}).then(function(t){return {g:t.indexOf('givenAnswer')>=0,a:t.indexOf('answerAdjusted')>=0,n:t.indexOf('answerNote')>=0,v:t.indexOf('24°')>=0};})", 60000);
  ok("导出含 givenAnswer", expFlags && expFlags.g === true);
  ok("导出含 answerAdjusted", expFlags && expFlags.a === true);
  ok("导出含 answerNote", expFlags && expFlags.n === true);
  ok("导出含给定答案原文", expFlags && expFlags.v === true);

  console.log("\n=== H. 服务端输入校验 ===");
  const mk = (given) => ({ question: "q", previous: { answer: "a", analysis: "b" }, instruction: "x", givenAnswer: given, config: CFG, stream: false });
  const post = async (given) => {
    const r = await fetch(API + "/api/refine", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(mk(given)) });
    return r.status;
  };
  ok("超长给定答案返回 400", (await post("a".repeat(4001))) === 400);
  ok("代码注入给定答案返回 400", (await post("```<script>x</script>")) === 400);

  const realErrs = pageErrs.filter((x) => !/favicon/i.test(String(x)));
  ok("页面无 JS 异常", realErrs.length === 0, realErrs.slice(0, 2).join(" | "));

  console.log("\n----------------------------------------");
  if (fails) { console.log("结果：有 " + fails + " 项失败"); process.exit(1); }
  console.log("结果：全部通过");
  process.exit(0);
})().catch((e) => { console.log("FATAL " + (e && e.stack || e)); process.exit(1); });
