// 冒烟：悬浮原题卡在 2D 下拖拽/缩放不带动画布；3D 下可拖拽/缩放；“悬停联动”接口可用
// 用法: node tools\smoke_qfloat.js   （需 8099 在跑）
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execSync } = require("child_process");
let proc = null;                      // 供异常退出时整棵进程树清理
function killEdge() { if (proc && proc.pid) { try { execSync("taskkill /pid " + proc.pid + " /t /f", { stdio: "ignore" }); } catch (e) {} } }
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9407;
const APP = "http://127.0.0.1:8099/solver/index.html";
const SHOTS = path.join(__dirname, "shots_new");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (n, c, x) => { if (c) console.log("  ok   " + n + (x ? "  [" + x + "]" : "")); else { console.log("  FAIL " + n + (x ? "  [" + x + "]" : "")); fails++; } };

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  try { await (await fetch("http://127.0.0.1:" + PORT + "/json/version")).json(); throw new Error("debug port " + PORT + " already in use"); } catch (e) { if (/already in use/.test(e.message)) throw e; }
  proc = spawn(EDGE, ["--headless=new", "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + path.join(os.tmpdir(), "edge-smoke-qfloat-" + process.pid),
    "--no-first-run", "--no-default-browser-check", "--disable-gpu", "about:blank"], { stdio: "ignore" });
  let ver = null;
  for (let i = 0; i < 60; i++) { try { ver = await (await fetch("http://127.0.0.1:" + PORT + "/json/version")).json(); break; } catch (e) { await sleep(250); } }
  if (!ver) throw new Error("no devtools");
  const t = await (await fetch("http://127.0.0.1:" + PORT + "/json/new?about:blank", { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const errors = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
    if (m.method === "Runtime.exceptionThrown") {
      const ex = m.params.exceptionDetails || {};
      errors.push("exception: " + (ex.exception && ex.exception.description || ex.text));
    }
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
      const txt = m.params.entry.text || "";
      if (!/favicon/i.test(txt)) errors.push("console: " + txt);
    }
  });
  await new Promise((r) => ws.addEventListener("open", r));
  const send = (m, p) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  const evalIn = async (expr, ms = 30000) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, timeout: ms }); const rr = r.result || {}; if (rr.exceptionDetails) throw new Error(rr.exceptionDetails.text + " " + (rr.exceptionDetails.exception && rr.exceptionDetails.exception.description || "")); return rr.result ? rr.result.value : null; };
  const until = async (expr, ms, step) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await evalIn(expr).catch(() => false); if (v) return v; await sleep(step || 400); } return false; };
  const ready = "!!(window.mathHTML&&window.HJ&&document.getElementById('go'))";

  // 真实鼠标拖拽（会同时产生 pointer / mouse 事件，能覆盖“拖卡片带动画布”的回归）
  async function mouseDrag(x0, y0, x1, y1) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0, y: y0, button: "none", buttons: 0 });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: x0, y: y0, button: "left", buttons: 1, clickCount: 1 });
    const N = 8;
    for (let i = 1; i <= N; i++) {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0 + (x1 - x0) * i / N, y: y0 + (y1 - y0) * i / N, button: "left", buttons: 1 });
      await sleep(16);
    }
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x1, y: y1, button: "left", buttons: 0, clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x1, y: y1, button: "none", buttons: 0 });
  }
  const shot = async (name) => {
    const r = await send("Page.captureScreenshot", { format: "png" });
    if (r.result && r.result.data) fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.result.data, "base64"));
  };
  const state = `(function(){
    var c=document.getElementById('qTextFloat'), f=document.getElementById('qFigFloat');
    function st(el){ if(!el||el.hidden) return null; var r=el.getBoundingClientRect(); return {l:el.style.left,t:el.style.top,w:Math.round(r.width),h:Math.round(r.height)}; }
    var bb=null; try{ bb=(window.board&&window.board.getBoundingBox())||null; }catch(e){}
    return {qtext:st(c),qfig:st(f),bb:bb};
  })()`;

  await send("Runtime.enable"); await send("Page.enable"); await send("Log.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: APP });
  const isReady = await until(ready, 45000);
  ok("页面加载就绪", !!isReady, await evalIn("JSON.stringify({rs:document.readyState,m:typeof window.mathHTML,hj:typeof window.HJ})"));
  ok("页面加载无控制台报错", errors.length === 0, errors.slice(0, 2).join(" | "));

  // 定位已知噪声：KaTeX 的 vec/overrightarrow 字形 SVG 在 Chromium 下会打一条 path 解析报错，
  // 与悬浮卡/画布改动无关（这里在没有任何悬浮卡交互时单独渲染一次，先证明它是既有噪声）
  const noise0 = errors.length;
  await evalIn("var d=document.createElement('div');d.style.display='none';d.innerHTML=window.mathHTML('$\\\\vec{AB}\\\\overrightarrow{CD}$');document.body.appendChild(d);1");
  await sleep(500);
  const vecNoise = errors.length - noise0;
  console.log("  info  KaTeX vec 静态渲染噪声: " + vecNoise + " 条（既有，非本次改动）");

  console.log("\n=== 1. 2D：拖拽悬浮原题文字卡 ===");
  await evalIn("document.getElementById('btnHist').click();1");
  await until("!!document.querySelector('#histList .hist-item')", 10000, 300);
  const opened = await evalIn(`(function(){var a=[].slice.call(document.querySelectorAll('#histList .hist-item'));var it=a.filter(function(x){return x.textContent.indexOf('DFE')>=0;})[0];if(!it)return false;it.click();return true;})()`);
  ok("从历史打开 2D 纯文字题", opened === true);
  ok("2D 画板渲染完成", !!(await until("!!window.board && document.getElementById('canvasHost').style.display!=='none'", 30000, 400)));
  await evalIn("document.getElementById('qTextFold').click();1"); // 展开
  await sleep(500);
  const a0 = await evalIn(state);
  ok("原题文字卡可见且已展开", !!(a0 && a0.qtext && a0.qtext.w > 0 && a0.qtext.h > 50));
  if (!a0 || !a0.qtext) throw new Error("qTextFloat not visible");
  const head = await evalIn("(function(){var r=document.getElementById('qTextHead').getBoundingClientRect();return {x:r.left+22,y:r.top+r.height/2};})()");
  await mouseDrag(head.x, head.y, head.x + 96, head.y + 74);
  await sleep(350);
  const a1 = await evalIn(state);
  ok("2D 拖拽后卡片位置已改变", a1.qtext.l !== a0.qtext.l || a1.qtext.t !== a0.qtext.t, "left " + a0.qtext.l + " -> " + a1.qtext.l);
  ok("2D 拖拽没有平移画布", JSON.stringify(a1.bb) === JSON.stringify(a0.bb), JSON.stringify(a0.bb) + " -> " + JSON.stringify(a1.bb));

  console.log("\n=== 2. 2D：缩放悬浮卡 + 卡内滚轮 ===");
  // 先把卡片往上挪，给向下缩放留出空间
  const head2 = await evalIn("(function(){var r=document.getElementById('qTextHead').getBoundingClientRect();return {x:r.left+22,y:r.top+r.height/2};})()");
  await mouseDrag(head2.x, head2.y, head2.x, Math.max(24, head2.y - 280));
  await sleep(300);
  const a1u = await evalIn(state);
  const grip = await evalIn("(function(){var r=document.getElementById('qTextResize').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height};})()");
  ok("缩放手柄可见", grip.w > 10 && grip.h > 10);
  await mouseDrag(grip.x, grip.y, grip.x + 80, grip.y + 60);
  await sleep(350);
  const a2 = await evalIn(state);
  ok("2D 缩放后卡片尺寸变大", a2.qtext.w >= a1u.qtext.w + 50 && a2.qtext.h >= a1u.qtext.h + 40, a1u.qtext.w + "x" + a1u.qtext.h + " -> " + a2.qtext.w + "x" + a2.qtext.h);
  ok("2D 缩放没有平移画布", JSON.stringify(a2.bb) === JSON.stringify(a0.bb));
  const body = await evalIn("(function(){var r=document.getElementById('qText').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+Math.min(40,r.height/2)};})()");
  await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: body.x, y: body.y, deltaX: 0, deltaY: 160 });
  await sleep(350);
  const a3 = await evalIn(state);
  ok("卡内滚轮没有缩放画布", JSON.stringify(a3.bb) === JSON.stringify(a0.bb));
  await shot("smoke_qfloat_2d.png");

  console.log("\n=== 3. 3D 图片题：悬浮原题图卡 ===");
  await evalIn("var hp=document.getElementById('histModal'); if(hp && !hp.classList.contains('show')) document.getElementById('btnHist').click();1");
  await until("!!document.querySelector('#histList .hist-item')", 10000, 300);
  const opened3d = await evalIn(`(function(){var a=[].slice.call(document.querySelectorAll('#histList .hist-item'));var it=a.filter(function(x){return x.textContent.indexOf('\u3010\u4f8b2\u3011')>=0;})[0];if(!it)return false;it.click();return true;})()`);
  ok("从历史打开 3D 图片题", opened3d === true);
  if (opened3d !== true) {
    const texts = await evalIn("[].slice.call(document.querySelectorAll('#histList .hist-item .qtext')).map(function(x){return x.textContent.slice(0,24);})");
    console.log("   候选记录:", JSON.stringify(texts));
  }
  const is3d = await until("!!(window.GGB3D&&window.GGB3D.getApi&&window.GGB3D.getApi()) && document.getElementById('g3d').style.display!=='none'", 30000, 400);
  ok("3D 画布渲染完成", !!is3d);
  ok("原题图卡可见", !!(await until("!document.getElementById('qFigFloat').hidden", 8000, 300)));
  await sleep(500);
  const b0 = await evalIn(state);
  if (b0 && b0.qfig) {
    const fhead = await evalIn("(function(){var r=document.getElementById('qFigHead').getBoundingClientRect();return {x:r.left+22,y:r.top+r.height/2};})()");
    await mouseDrag(fhead.x, fhead.y, fhead.x + 70, fhead.y + 60);
    await sleep(300);
    const b1 = await evalIn(state);
    ok("3D 拖拽后题图卡位置已改变", b1.qfig.l !== b0.qfig.l || b1.qfig.t !== b0.qfig.t);
    const fgrip = await evalIn("(function(){var r=document.getElementById('qFigResize').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height};})()");
    ok("3D 缩放手柄可见", fgrip.w > 10 && fgrip.h > 10);
    await mouseDrag(fgrip.x, fgrip.y, fgrip.x + 70, fgrip.y + 50);
    await sleep(300);
    const b2 = await evalIn(state);
    ok("3D 缩放后题图卡尺寸变大", b2.qfig.w >= b1.qfig.w + 30 && b2.qfig.h >= b1.qfig.h + 20, b1.qfig.w + "x" + b1.qfig.h + " -> " + b2.qfig.w + "x" + b2.qfig.h);
  } else {
    ok("3D 题图卡可见（拖拽/缩放）", false);
  }
  const hoverOk = await evalIn(`(function(){
    try{
      if(!(window.GGB3D&&window.GGB3D.getApi&&window.GGB3D.getApi())) return 'no-3d';
      var api=window.GGB3D.getApi(); var it=(api.items||[]).filter(function(i){return i.type==='point'&&i.vis!==false;})[0];
      if(!it) return 'no-point';
      window.HJ.hoverObject(String(it.id));
      var on=!!document.querySelector('#objList .obj.hover');
      window.HJ.hoverObject(null);
      return on ? 'ok' : 'no-highlight';
    }catch(e){ return 'err:'+e.message; }
  })()`);
  ok("3D 悬停联动左侧列表", hoverOk === "ok", hoverOk);
  await shot("smoke_qfloat_3d.png");

  console.log("\n=== 4. 控制台 ===");
  const noise = errors.filter((e) => /attribute d: Expected number/.test(e));
  const real = errors.filter((e) => !/attribute d: Expected number/.test(e));
  console.log("  info  KaTeX 字形 path 解析噪声: " + noise.length + " 条（既有）");
  ok("无 JS 异常 / 其他控制台报错", real.length === 0, real.slice(0, 3).join(" | "));

  console.log("\n----------------------------------------");
  try { ws.send(JSON.stringify({ id: ++id, method: "Browser.close" })); } catch (e) {}
  await sleep(300);
  killEdge();
  if (fails) { console.log("RESULT: " + fails + " failed"); process.exit(1); }
  console.log("RESULT: all passed");
  process.exit(0);
})().catch((e) => { console.log("FATAL " + (e && e.message)); killEdge(); process.exit(1); });