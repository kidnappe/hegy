// 任务面板自检：进行中=卡片（带进度条）、已完成=紧凑单行、查看可回看、清除已完成可用
// 用法: node tools\task_panel_test.js   （需 8099 + 8098 在跑）
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
require("./_cfg_guard").install(); // U-17：跑前备份真实配置，退出/异常一律恢复
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9412;
const APP = "http://127.0.0.1:8099/solver/index.html";
const API = "http://127.0.0.1:8099";
const TEST_DIR = path.join(os.tmpdir(), "hegy-panel-test");
const SHOTS = path.join(__dirname, "shots_new");
const HOME = path.join(os.homedir(), ".hegy");
const SETTINGS = path.join(HOME, "settings.json");
const SETTINGS_BAK = path.join(HOME, "settings.json.bak_agent");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (n, c, x) => { if (c) console.log("  ok   " + n + (x ? "  [" + x + "]" : "")); else { console.log("  FAIL " + n + (x ? "  [" + x + "]" : "")); fails++; } };
const apiPost = async (p, b) => (await fetch(API + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b || {}) })).json();

(async () => {
  await fs.promises.mkdir(SHOTS, { recursive: true });
  await fs.promises.mkdir(TEST_DIR, { recursive: true });
  const proc = spawn(EDGE, ["--headless=new", "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + path.join(os.tmpdir(), "edge-diag-panel"),
    "--no-first-run", "--no-default-browser-check", "--disable-gpu", "about:blank"], { stdio: "ignore" });
  let ver = null;
  for (let i = 0; i < 60; i++) { try { ver = await (await fetch("http://127.0.0.1:" + PORT + "/json/version")).json(); break; } catch (e) { await sleep(250); } }
  if (!ver) throw new Error("no devtools");
  const t = await (await fetch("http://127.0.0.1:" + PORT + "/json/new?" + encodeURIComponent(APP), { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  await new Promise((r) => ws.addEventListener("open", r));
  const send = (m, p) => new Promise((res) => {
    const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p || {} }));
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); res({}); } }, 20000);
  });
  const evalIn = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result && r.result.exceptionDetails) console.log("  eval-err", JSON.stringify(((r.result.exceptionDetails.exception || {}).description || "").slice(0, 200))); return r.result && r.result.result ? r.result.result.value : null; };
  const until = async (expr, ms, step) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await evalIn(expr).catch(() => false); if (v) return v; await sleep(step || 400); } return false; };
  const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(SHOTS, name), Buffer.from(s.result.data, "base64")); console.log("  shot " + name); };
  const ready = "!!(window.mathHTML&&document.getElementById('go')&&window.SolverDebug)";

  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
  await apiPost("/api/cfg", { config: { baseUrl: "http://127.0.0.1:8098/v1", apiKey: "mock", model: "mock", temperature: 0.2 } });
  await apiPost("/api/store/dir", { dir: TEST_DIR, migrate: false });
  await apiPost("/api/store/purge", {});
  await send("Page.reload"); await until(ready, 30000);
  await evalIn("localStorage.setItem('solver_cfg_v1', JSON.stringify({baseUrl:'http://127.0.0.1:8098/v1',apiKey:'mock',model:'mock',temperature:0.2}));localStorage.removeItem('solver_tasks_v1');localStorage.removeItem('solver_dim_v1');1");
  await send("Page.reload"); await until(ready, 30000);

  console.log("\n=== A. 进行中：卡片 + 进度条 ===");
  await evalIn("document.getElementById('q').value='慢速40：任务面板进行中示例题';document.getElementById('go').click();1");
  await until("SolverDebug.tasks().filter(function(t){return t.status==='running';}).length===1", 15000, 300);
  await evalIn("document.getElementById('sbTask').click();1");
  await sleep(400);
  ok("面板已展开", await evalIn("document.getElementById('taskPanel').style.display==='block'"));
  ok("进行中显示为卡片", await evalIn("document.querySelectorAll('#taskPanel .tp-card').length===1"));
  ok("卡片带进度条", await evalIn("!!document.querySelector('#taskPanel .tp-card .tp-bar')"));
  ok("卡片有「取消」按钮", await evalIn("[...document.querySelectorAll('#taskPanel .tp-card .tp-acts button')].some(b=>b.textContent==='取消')"));
  await shot("feature_task_running.png");

  console.log("\n=== B. 已完成：紧凑单行 ===");
  // 再解两题（正常速度），让已完成条目出现
  for (const q of ["如图，在 Rt△ABC 中，∠C=90°，AC=3，BC=4，求 AB 的长。", "AD 平分∠BAC，求∠DFE。"]) {
    await evalIn("document.getElementById('q').value=" + JSON.stringify(q) + ";document.getElementById('go').click();1");
    await until("document.getElementById('status').textContent.indexOf('脚本')>=0", 90000, 500);
    await until("SolverDebug.tasks().filter(function(t){return t.status==='running';}).length<=1", 15000, 300);
    await sleep(600);
  }
  const doneRows = await evalIn("document.querySelectorAll('#taskPanel .tp-row').length");
  ok("已完成条目渲染为单行", doneRows >= 2, "行数=" + doneRows);
  ok("已完成条目不再用卡片", await evalIn("document.querySelectorAll('#taskPanel .tp-row .tp-card').length===0 && document.querySelectorAll('#taskPanel .tp-card').length===1"), "卡片数=" + await evalIn("document.querySelectorAll('#taskPanel .tp-card').length"));
  ok("单行含「查看」入口", await evalIn("document.querySelectorAll('#taskPanel .tp-row .tp-view').length") >= 2,
    await evalIn("[...document.querySelectorAll('#taskPanel .tp-row')].map(function(r){return r.getAttribute('data-id')+'::'+r.textContent.replace(/\\s+/g,' ');}).join(' || ')"));
  ok("「查看」常亮不置灰", await evalIn("(function(){var v=document.querySelector('#taskPanel .tp-row .tp-view');if(!v)return false;var cs=getComputedStyle(v),ps=getComputedStyle(v.parentNode);return ps.opacity==='1'&&cs.backgroundColor!=='rgba(0, 0, 0, 0)'&&cs.color!=='rgba(0, 0, 0, 0)';})()"));
  ok("单行含移除按钮", await evalIn("document.querySelectorAll('#taskPanel .tp-row .tp-x').length") >= 2);
  const times = await evalIn("[...document.querySelectorAll('#taskPanel .tp-row .tp-row-meta')].map(function(e){return e.textContent;}).join(' | ')");
  ok("单行显示相对时间", /刚刚|\d+ 分钟前|\d{2}:\d{2}/.test(times), times);
  // 面板高度不应被历史任务撑爆
  ok("面板高度受控（<460px）", await evalIn("document.getElementById('taskPanel').getBoundingClientRect().height<=460"), await evalIn("Math.round(document.getElementById('taskPanel').getBoundingClientRect().height) + 'px，行高 ' + Math.round(document.querySelector('#taskPanel .tp-row').getBoundingClientRect().height) + 'px'"));
  await shot("feature_task_panel.png");

  console.log("\n=== B2. 头部控件（去重 + 不挤） ===");
  const headBtns = await evalIn("[...document.querySelectorAll('#taskPanel .tp-head button')].map(function(b){return b.textContent.trim();})");
  ok("头部只剩「清除已完成 / 收起」两个按钮", JSON.stringify(headBtns) === JSON.stringify(["清除已完成", "收起"]), JSON.stringify(headBtns));
  ok("头部不再有重复的 ✕ / 图标关闭按钮", await evalIn("document.querySelectorAll('#taskPanel .tp-head .tp-x,#taskPanel .tp-head svg').length===0"),
    "tp-x=" + await evalIn("document.querySelectorAll('#taskPanel .tp-head .tp-x').length"));
  const headGeom = await evalIn("(function(){var bs=[...document.querySelectorAll('#taskPanel .tp-head button')];var r=bs.map(function(b){var q=b.getBoundingClientRect();return {t:b.textContent.trim(),x:Math.round(q.left),y:Math.round(q.top),w:Math.round(q.width),h:Math.round(q.height)};});var h=document.querySelector('#taskPanel .tp-head').getBoundingClientRect();var body=document.querySelector('#taskPanel').getBoundingClientRect();return {btns:r,headH:Math.round(h.height),over:Math.round(r.length>1?(r[1].x-(r[0].x+r[0].w)):-999),inside:r.every(function(a){return a.x>=body.left&&a.x+a.w<=body.right;})};})()");
  ok("头部两个按钮同一行、不重叠、都在面板内", headGeom && headGeom.btns.length === 2 && headGeom.btns[0].y === headGeom.btns[1].y && headGeom.over >= 4 && headGeom.inside, JSON.stringify(headGeom));
  ok("头部是单行（高度 ≤ 34px）", headGeom && headGeom.headH <= 34, headGeom && headGeom.headH + "px");
  ok("头部按钮有可点的内边距（高 ≥ 18px）", headGeom && headGeom.btns.every(function(b){return b.h >= 18;}), headGeom && headGeom.btns.map(function(b){return b.h;}).join("/"));
  await shot("feature_task_head.png");

  ok("进行中排在已完成之前", await evalIn("document.querySelector('#taskPanel > div:nth-child(2)').className.indexOf('tp-card')===0"),
    await evalIn("[...document.querySelectorAll('#taskPanel > div')].map(function(d){return d.className;}).join(',')"));
  console.log("\n=== C. 查看 / 清除已完成 ===");
  const panelOpenExpr = "document.getElementById('taskPanel').style.display==='block'";
  const openPanel = async () => { if (!(await evalIn(panelOpenExpr))) { await evalIn("document.getElementById('sbTask').click();1"); await sleep(400); } };
  const before = await evalIn("document.getElementById('answer').textContent.slice(0,20)");
  const viewCount = await evalIn("document.querySelectorAll('#taskPanel .tp-view, #taskPanel .tp-row .tp-view').length");
  ok("有可查看的已完成条目", viewCount >= 1, "查看按钮数=" + viewCount);
  await evalIn("document.querySelectorAll('#taskPanel .tp-row .tp-view')[0].click();1");
  await sleep(700);
  ok("点「查看」可回看记录", await evalIn("document.getElementById('answer').textContent.length>6"), "改前：" + before + " → 改后：" + await evalIn("document.getElementById('answer').textContent.slice(0,20)"));
  await openPanel();
  console.log("  面板状态:", await evalIn("document.getElementById('taskPanel').style.display + ' | ' + document.getElementById('taskPanel').innerText.replace(/\\s+/g,' ').slice(0,80)"));
  await evalIn("[...document.querySelectorAll('#taskPanel .tp-head button')].find(b=>b.textContent==='清除已完成').click();1");
  await sleep(400);
  ok("清除已完成只剩进行中的卡片", await evalIn("document.querySelectorAll('#taskPanel .tp-row').length===0 && document.querySelectorAll('#taskPanel .tp-card').length===1"));
  await openPanel();
  await evalIn("[...document.querySelectorAll('#taskPanel .tp-card .tp-acts button')].find(b=>b.textContent==='取消').click();1");
  await sleep(600);
  await shot("feature_task_cleared.png");

  console.log("\n----------------------------------------");
  try { await fetch(API + "/api/task/0/cancel", { method: "POST" }); } catch (e) {}
  try { proc.kill(); } catch (e) {}
  try { fs.copyFileSync(SETTINGS_BAK, SETTINGS); console.log("settings.json 已恢复"); } catch (e) {}
  if (fails) { console.log("结果：有 " + fails + " 项失败"); process.exit(1); }
  console.log("结果：全部通过");
  process.exit(0);
})().catch((e) => { console.log("FATAL " + e.message); process.exit(1); });
