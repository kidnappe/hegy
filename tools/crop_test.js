// 手动「框选题图」交互自检：在图上拖动 → 保存 → 记录里 figureBox 被改写 → 题图重新裁剪
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
require("./_cfg_guard").install(); // U-17：跑前备份真实配置，退出/异常一律恢复
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9407;
const APP = "http://127.0.0.1:8099/solver/index.html";
const API = "http://127.0.0.1:8099";
const TEST_DIR = "D:\\software\\tmp\\opencode\\hegy-crop";
const HOME = path.join(os.homedir(), ".hegy");
const SETTINGS = path.join(HOME, "settings.json");
const SETTINGS_BAK = path.join(HOME, "settings.json.bak_agent");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (n, c, x) => { if (c) console.log("  ok   " + n + (x ? "  [" + x + "]" : "")); else { console.log("  FAIL " + n + (x ? "  [" + x + "]" : "")); fails++; } };
const api = async (p) => (await fetch(API + p)).json();
const apiPost = async (p, b) => (await fetch(API + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b || {}) })).json();

(async () => {
  const proc = spawn(EDGE, ["--headless=new", "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + path.join(os.tmpdir(), "edge-diag-crop"),
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
    // CDP 偶发丢响应时不要让脚本永久挂起
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); res({}); } }, 20000);
  });
  const evalIn = async (expr, ms = 30000) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, timeout: ms }); if (r.result && r.result.exceptionDetails) console.log("  eval-err", JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || "").slice(0, 200)); return r.result && r.result.result ? r.result.result.value : null; };
  const until = async (expr, ms, step) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await evalIn(expr).catch(() => false); if (v) return v; await sleep(step || 400); } return false; };
  const ready = "!!(window.mathHTML&&document.getElementById('go')&&window.SolverDebug)";
  const mouse = (type, x, y, extra) => send("Input.dispatchMouseEvent", Object.assign({ type: type, x: x, y: y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 }, extra || {}));

  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.reload"); await until(ready, 30000);
  await apiPost("/api/cfg", { config: { baseUrl: "http://127.0.0.1:8098/v1", apiKey: "mock", model: "mock", temperature: 0.2 } });
  await apiPost("/api/store/dir", { dir: TEST_DIR, migrate: false });
  await apiPost("/api/store/purge", {});
  await evalIn("localStorage.setItem('solver_cfg_v1', JSON.stringify({baseUrl:'http://127.0.0.1:8098/v1',apiKey:'mock',model:'mock',temperature:0.2}));1");
  await send("Page.reload"); await until(ready, 30000);

  // 图片题（mock 给 figureBox）
  await evalIn(`(function(){
    var c=document.createElement('canvas');c.width=480;c.height=360;
    var x=c.getContext('2d');
    // 随机噪点保证 PNG > 10KB（addImageFile 有"过小"校验）
    for(var i=0;i<480;i+=4){for(var j=0;j<360;j+=4){x.fillStyle='rgb('+((Math.random()*255)|0)+','+((Math.random()*255)|0)+','+((Math.random()*255)|0)+')';x.fillRect(i,j,4,4);}}
    x.fillStyle='rgba(255,255,255,.85)';x.fillRect(10,20,460,60);
    x.fillStyle='#333';x.font='16px sans-serif';x.fillText('题目图形区域测试',24,56);
    x.strokeStyle='#c00';x.lineWidth=5;x.beginPath();x.moveTo(100,300);x.lineTo(380,300);x.lineTo(240,150);x.closePath();x.stroke();
    var u=c.toDataURL('image/png');
    var bin=atob(u.split(',')[1]);var a=new Uint8Array(bin.length);
    for(var k=0;k<bin.length;k++)a[k]=bin.charCodeAt(k);
    SolverDebug.addImageFile(new File([a],'q.png',{type:'image/png'}));
    return u.length;
  })()`);
  const gotImg = await until("document.querySelectorAll('#thumbs .thumb').length===1", 8000, 300);
  ok("测试图片已加入", !!gotImg, await evalIn("SolverDebug.images().length + ' 张 / ' + document.getElementById('qWarn').textContent"));
  await evalIn("document.getElementById('q').value='';document.getElementById('go').click();1");
  const solved = await until("document.getElementById('status').textContent.indexOf('脚本')>=0", 60000, 500);
  ok("图片题解出", !!solved, await evalIn("document.getElementById('status').textContent + ' | ' + SolverDebug.tasks().map(t=>t.status+':'+t.stage).join(',')"));
  await until("!!document.querySelector('#qFig img.qfig-main')", 8000, 300);
  const recId = await evalIn("fetch('/api/store/index').then(r=>r.json()).then(j=>((j.items||[])[0]||{}).id)");

  console.log("\n=== 框选题图交互 ===");
  const hasBtn = await evalIn("!![...document.querySelectorAll('#qFig .qfig-open')].find(b=>b.textContent==='重新框选题图')");
  if (!hasBtn) console.log("  DOM:", await evalIn("(document.getElementById('qCard').style.display)+' | '+document.getElementById('qFig').innerHTML.slice(0,300)"));
  ok("已有 AI 框时提供「重新框选题图」", hasBtn);
  await evalIn("[...document.querySelectorAll('#qFig .qfig-open')].find(b=>b.textContent==='重新框选题图').click();1");
  await sleep(400);
  ok("进入框选模式（出现裁剪层）", await evalIn("!!document.querySelector('#qFig .crop-wrap img') && !!document.querySelector('#qFig .crop-box')"));
  ok("保存按钮初始禁用", await evalIn("!!document.querySelector('#qFig .crop-acts button[disabled]')"));

  const rect = await evalIn("(function(){var r=document.querySelector('#qFig .crop-wrap img').getBoundingClientRect();return JSON.stringify({x:r.left,y:r.top,w:r.width,h:r.height});})()");
  const R = JSON.parse(rect);
  console.log("  图片显示尺寸:", Math.round(R.w) + "x" + Math.round(R.h));
  // 从 (20%,20%) 拖到 (80%,75%)
  const x1 = Math.round(R.x + R.w * 0.2), y1 = Math.round(R.y + R.h * 0.2);
  const x2 = Math.round(R.x + R.w * 0.8), y2 = Math.round(R.y + R.h * 0.75);
  await mouse("mousePressed", x1, y1);
  await mouse("mouseMoved", Math.round((x1 + x2) / 2), Math.round((y1 + y2) / 2));
  await mouse("mouseMoved", x2, y2);
  await mouse("mouseReleased", x2, y2);
  await sleep(300);
  const bandBox = await evalIn("(function(){var b=document.querySelector('#qFig .crop-box');return b?b.style.width+'/'+b.style.height:'无';})()");
  ok("拖拽生成选框", /\d/.test(bandBox) && bandBox !== "0px/0px", bandBox);
  ok("保存按钮已可用", await evalIn("![...document.querySelectorAll('#qFig .crop-acts button')].find(b=>b.textContent==='保存为题图').disabled"));
  await evalIn("[...document.querySelectorAll('#qFig .crop-acts button')].find(b=>b.textContent==='保存为题图').click();1");
  await sleep(900);
  ok("保存后退出框选模式", await evalIn("!document.querySelector('#qFig .crop-wrap')"));
  const saved = await api("/api/store/record/" + encodeURIComponent(recId));
  const fb = saved.figureBox || {};
  ok("记录里的 figureBox 已改写", Math.abs(fb.x - 0.2) < 0.05 && Math.abs(fb.y - 0.2) < 0.05 && Math.abs(fb.w - 0.6) < 0.05 && Math.abs(fb.h - 0.55) < 0.05, JSON.stringify(fb));
  ok("答案/解析未被改动", String(saved.analysis || "").indexOf("mock 识别题干") < 0 && String(saved.answer || "").length > 5);
  await until("!!document.querySelector('#qFig img.qfig-main')", 8000, 300);
  ok("题图按新区域重新裁剪", await evalIn("(function(){var im=document.querySelector('#qFig img.qfig-main');return !!(im&&im.src.indexOf('data:image/jpeg')===0);})()"));
  const s = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(__dirname, "shots_new", "feature_crop.png"), Buffer.from(s.result.data, "base64"));

  console.log("\n=== 未框选（AI 未给 figureBox）的兜底入口 ===");
  // 模拟"模型没给 figureBox"：清掉框，只留原图
  await evalIn("(function(){var L=SolverDebug.last();L.result.figureBox=null;SolverDebug.renderQCard(L.result);return 1;})()");
  await sleep(300);
  const cropBtn = await evalIn("!![...document.querySelectorAll('#qFig .qfig-open')].find(b=>b.textContent==='框选题图')");
  ok("无 AI 框时提供「框选题图」", cropBtn);
  ok("无 AI 框时直接展示原图", await evalIn("!!document.querySelector('#qFig img.qfig-main')"));
  await evalIn("[...document.querySelectorAll('#qFig .qfig-open')].find(b=>b.textContent==='框选题图').click();1");
  await sleep(300);
  ok("兜底入口可进入框选模式", await evalIn("!!document.querySelector('#qFig .crop-wrap img')"));
  await evalIn("[...document.querySelectorAll('#qFig .crop-acts button')].find(b=>b.textContent==='取消').click();1");
  await sleep(300);
  ok("取消后回到原图展示", await evalIn("!document.querySelector('#qFig .crop-wrap') && !!document.querySelector('#qFig img.qfig-main')"));

  console.log("\n----------------------------------------");
  try { proc.kill(); } catch (e) {}
  try { fs.copyFileSync(SETTINGS_BAK, SETTINGS); console.log("settings.json 已恢复"); } catch (e) {}
  if (fails) { console.log("结果：有 " + fails + " 项失败"); process.exit(1); }
  console.log("结果：全部通过");
  process.exit(0);
})().catch((e) => { console.log("FATAL " + e.message); process.exit(1); });
