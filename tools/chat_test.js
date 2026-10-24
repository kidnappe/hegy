// 追问（多轮纯问答）自检：
// 聊天卡出现 / 流式回答 / 多轮上下文 / 不新增版本 / 不改答案 / 随记录保存 / 刷新恢复 / 清空
// 用法: node tools\chat_test.js   （需 8099 + 8098 在跑）
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9416;
const APP = "http://127.0.0.1:8099/solver/index.html";
const API = "http://127.0.0.1:8099";
const TEST_DIR = path.join(os.tmpdir(), "hegy-chat-test");
const SHOTS = path.join(__dirname, "shots_new");
const HOME = path.join(os.homedir(), ".hegy");
const SETTINGS = path.join(HOME, "settings.json");
const ORIG_SETTINGS = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (n, c, x) => { if (c) console.log("  ok   " + n + (x ? "  [" + x + "]" : "")); else { console.log("  FAIL " + n + (x ? "  [" + x + "]" : "")); fails++; } };
const apiPost = async (p, b) => (await fetch(API + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b || {}) })).json();
function restoreSettings() {
  try {
    fs.mkdirSync(HOME, { recursive: true });
    if (ORIG_SETTINGS) fs.writeFileSync(SETTINGS, ORIG_SETTINGS);
    else if (fs.existsSync(SETTINGS)) fs.unlinkSync(SETTINGS);
    console.log("settings.json 已恢复");
  } catch (e) { console.log("settings.json 恢复失败：" + e.message); }
}
process.on("exit", restoreSettings);

(async () => {
  await fs.promises.mkdir(SHOTS, { recursive: true });
  await fs.promises.mkdir(TEST_DIR, { recursive: true });
  const proc = spawn(EDGE, ["--headless=new", "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + path.join(os.tmpdir(), "edge-diag-chat"),
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
  const ready = "!!(window.mathHTML&&document.getElementById('go')&&document.getElementById('chatSend')&&window.SolverDebug)";
  const chatDone = "SolverDebug.chat()===null";

  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 950, deviceScaleFactor: 1, mobile: false });
  await apiPost("/api/cfg", { config: { baseUrl: "http://127.0.0.1:8098/v1", apiKey: "mock", model: "mock", temperature: 0.2 } });
  await apiPost("/api/store/dir", { dir: TEST_DIR, migrate: false });
  await apiPost("/api/store/purge", {});
  await send("Page.reload"); await until(ready, 30000);
  await evalIn("localStorage.setItem('solver_cfg_v1', JSON.stringify({baseUrl:'http://127.0.0.1:8098/v1',apiKey:'mock',model:'mock',temperature:0.2}));localStorage.removeItem('solver_tasks_v1');localStorage.removeItem('solver_dim_v1');localStorage.removeItem('solver_grade_v1');1");
  await send("Page.reload"); await until(ready, 30000);

  console.log("\n=== A. 解题后出现追问卡 ===");
  await evalIn("document.getElementById('q').value='如图，AD 平分∠BAC，F 是射线 DA 上一点，过 F 作 FE⊥BC 于 E。若∠B=40°，∠C=60°，求∠DFE。';document.getElementById('go').click();1");
  await until("document.getElementById('status').textContent.indexOf('脚本')>=0", 90000, 400);
  await until("SolverDebug.tasks().filter(function(t){return t.status==='running';}).length===0", 15000, 300);
  await sleep(700);
  const recId = await evalIn("SolverDebug.recId()");
  ok("解题成功并有记录 id", !!recId, recId || "");
  ok("追问卡已显示", await evalIn("getComputedStyle(document.getElementById('chatCard')).display!=='none'"));
  ok("答案卡有追问入口", await evalIn("getComputedStyle(document.getElementById('chatJump')).display!=='none' && document.getElementById('chatJump').textContent==='追问'"));
  ok("初始为空态提示", (await evalIn("document.getElementById('chatList').textContent")).indexOf("有不懂的地方") >= 0);
  ok("初始没有聊天消息", await evalIn("document.querySelectorAll('#chatList .chat-msg').length===0"));
  ok("初始只有 1 个版本", await evalIn("SolverDebug.versions().list.length===1"));
  ok("答案里的关键结论已加粗", await evalIn("document.querySelectorAll('#answer strong').length") > 0);
  ok("解析里的关键步骤已加粗", await evalIn("document.querySelectorAll('#analysis strong').length") > 0);
  const beforeAnswer = await evalIn("document.getElementById('answer').textContent");
  await shot("feature_chat_empty.png");

  console.log("\n=== B. 第一轮：流式回答 ===");
  await evalIn("document.getElementById('chatIn').value='为什么 ∠DFE 等于 10°？';document.getElementById('chatSend').click();1");
  ok("用户消息立即出现", await until("document.querySelectorAll('#chatList .chat-msg.user').length===1", 5000, 100));
  ok("流式阶段有增量文本", await until("(function(){var a=SolverDebug.chat();return a&&a.status==='running'&&a.text.length>0;})()", 8000, 80),
    await evalIn("JSON.stringify(SolverDebug.chat())"));
  ok("回答完成", await until(chatDone + " && document.querySelectorAll('#chatList .chat-msg.ai').length===1", 20000, 150));
  const ai1 = await evalIn("document.querySelector('#chatList .chat-msg.ai .chat-bubble').textContent");
  ok("第一轮回答含 mock 标记", /mock 追问/.test(ai1 || ""), (ai1 || "").slice(0, 70));
  ok("第一轮回答渲染了公式", await evalIn("document.querySelectorAll('#chatList .chat-msg.ai .katex').length") > 0);
  ok("回答里的 **关键结论** 渲染为加粗", await evalIn("document.querySelectorAll('#chatList .chat-msg.ai .chat-bubble strong').length") > 0);
  ok("聊天行内公式没有横向滚动条", await evalIn("[...document.querySelectorAll('#chatList .katex-holder')].every(function(el){return getComputedStyle(el).overflowX==='visible';})"));
  ok("回答不改答案", await evalIn("document.getElementById('answer').textContent===" + JSON.stringify(beforeAnswer)) === true);
  ok("回答不新增版本", await evalIn("SolverDebug.versions().list.length===1"));
  ok("聊天任务不写入刷新恢复列表", await evalIn("JSON.parse(localStorage.getItem('solver_tasks_v1')||'[]').filter(function(t){return t.kind==='chat';}).length===0"));
  const rec1 = await evalIn("fetch('/api/store/record/'+encodeURIComponent(SolverDebug.recId())).then(function(r){return r.json()}).then(function(j){return {chat:(j.chat||[]).length,versions:(j.versions||[]).length,answer:j.answer};})");
  ok("记录已保存聊天（2 条）", rec1 && rec1.chat === 2, JSON.stringify(rec1));
  ok("记录版本数仍为 1", rec1 && rec1.versions === 1);
  await shot("feature_chat_first.png");

  console.log("\n=== B2. 收起/展开追问 ===");
  await evalIn("document.getElementById('chatFold').click();1");
  await sleep(250);
  ok("追问卡可收起", await evalIn("document.getElementById('chatCard').classList.contains('folded') && getComputedStyle(document.getElementById('chatList')).display==='none'"));
  ok("收起状态已记住", (await evalIn("localStorage.getItem('solver_chat_open_v1')")) === "0");
  await evalIn("document.getElementById('chatJump').click();1");
  await sleep(300);
  ok("从答案卡点「追问」会自动展开", await evalIn("!document.getElementById('chatCard').classList.contains('folded') && localStorage.getItem('solver_chat_open_v1')==='1'"));

  console.log("\n=== C. 第二轮：多轮上下文 ===");
  await evalIn("document.getElementById('chatIn').value='那如果 ∠B 改成 50°，结论会怎样？';document.getElementById('chatSend').click();1");
  ok("第二轮回答完成", await until(chatDone + " && document.querySelectorAll('#chatList .chat-msg.ai').length===2", 20000, 150));
  const ai2 = await evalIn("[...document.querySelectorAll('#chatList .chat-msg.ai .chat-bubble')].pop().textContent");
  ok("第二轮标为第 2 轮", /第 2 轮/.test(ai2 || ""), (ai2 || "").slice(0, 70));
  ok("第二轮带上了历史消息", /历史消息 3 条/.test(ai2 || ""), (ai2 || "").match(/历史消息[^）]*/)?.[0] || "");
  ok("聊天共保存 4 条", await evalIn("fetch('/api/store/record/'+encodeURIComponent(SolverDebug.recId())).then(function(r){return r.json()}).then(function(j){return (j.chat||[]).length;})") === 4);
  ok("多轮后仍只有 1 个版本", await evalIn("SolverDebug.versions().list.length===1"));
  ok("多轮后答案未变", await evalIn("document.getElementById('answer').textContent===" + JSON.stringify(beforeAnswer)) === true);
  ok("界面已有 4 条消息", await evalIn("document.querySelectorAll('#chatList .chat-msg').length===4"));
  ok("追问入口显示轮数", await evalIn("document.getElementById('chatJump').textContent==='追问 2'"), await evalIn("document.getElementById('chatJump').textContent"));
  await shot("feature_chat_multi.png");

  console.log("\n=== D. 微调 / 切换版本后聊天仍在 ===");
  await evalIn("document.getElementById('rin').value='把解析写详细一点';document.getElementById('btnRefine').click();1");
  ok("微调进入待确认", await until("!!SolverDebug.review()", 20000, 150));
  ok("待确认期间聊天仍有 4 条", await evalIn("document.querySelectorAll('#chatList .chat-msg').length===4"),
    "条数=" + await evalIn("document.querySelectorAll('#chatList .chat-msg').length"));
  await evalIn("document.getElementById('rbKeep').click();1");
  await until("SolverDebug.review()===null", 10000, 200);
  await sleep(600);
  ok("存为新版本后共 2 版", await evalIn("SolverDebug.versions().list.length===2"));
  ok("存为新版本后聊天仍有 4 条", await evalIn("document.querySelectorAll('#chatList .chat-msg').length===4"));
  const rec2 = await evalIn("fetch('/api/store/record/'+encodeURIComponent(SolverDebug.recId())).then(function(r){return r.json()}).then(function(j){return {chat:(j.chat||[]).length,versions:(j.versions||[]).length};})");
  ok("记录里聊天与版本同时保留", rec2 && rec2.chat === 4 && rec2.versions === 2, JSON.stringify(rec2));
  await evalIn("if(!document.querySelector('#verList .ver-item'))document.getElementById('verToggle').click();1");
  ok("版本抽屉展开", await until("document.querySelectorAll('#verList .ver-item').length===2", 5000, 100));
  await evalIn("document.querySelector('#verList .ver-item[data-vid=\"1\"] .ver-acts button').click();1");
  ok("切换到 v1", await until("SolverDebug.versions().currentVid===1", 10000, 200));
  ok("切换版本后聊天仍有 4 条", await evalIn("document.querySelectorAll('#chatList .chat-msg').length===4"));
  await shot("feature_chat_versions.png");
  const answerAfter = await evalIn("document.getElementById('answer').textContent");

  console.log("\n=== E. 刷新后从记录恢复 ===");
  await send("Page.reload"); await until(ready, 30000);
  await until("document.querySelectorAll('#histList .hist-item').length>=1", 15000, 200);
  ok("刷新后记录仍在", await evalIn("document.querySelectorAll('#histList .hist-item').length") >= 1);
  await evalIn("document.querySelector('#histList .hist-item').click();1");
  ok("重新打开记录", await until("SolverDebug.recId()===" + JSON.stringify(recId), 10000, 200), recId);
  await sleep(500);
  ok("聊天卡恢复显示", await evalIn("getComputedStyle(document.getElementById('chatCard')).display!=='none'"));
  ok("聊天消息恢复为 4 条", await evalIn("document.querySelectorAll('#chatList .chat-msg').length===4"), "条数=" + await evalIn("document.querySelectorAll('#chatList .chat-msg').length"));
  ok("恢复的历史里仍有公式", await evalIn("document.querySelectorAll('#chatList .chat-msg.ai .katex').length") > 0);
  ok("历史列表显示追问条数", (await evalIn("document.querySelector('#histList .hist-item .sub').textContent")).indexOf("追问 4 条") >= 0,
    await evalIn("document.querySelector('#histList .hist-item .sub').textContent"));
  await shot("feature_chat_restored.png");

  console.log("\n=== F. 清空聊天不影响解答 ===");
  await evalIn("window.confirm=function(){return true};document.getElementById('chatClear').click();1");
  ok("清空后消息归零", await until("document.querySelectorAll('#chatList .chat-msg').length===0", 5000, 100));
  await sleep(500);
  ok("记录里的聊天也清空", await evalIn("fetch('/api/store/record/'+encodeURIComponent(SolverDebug.recId())).then(function(r){return r.json()}).then(function(j){return (j.chat||[]).length;})") === 0);
  ok("清空后答案不变", await evalIn("document.getElementById('answer').textContent===" + JSON.stringify(answerAfter)) === true);
  ok("清空后版本仍为 2", await evalIn("SolverDebug.versions().list.length===2"));
  await shot("feature_chat_cleared.png");

  console.log("\n----------------------------------------");
  try { proc.kill(); } catch (e) {}
  if (fails) { console.log("结果：有 " + fails + " 项失败"); process.exit(1); }
  console.log("结果：全部通过");
  process.exit(0);
})().catch((e) => { console.log("FATAL " + e.message); process.exit(1); });
